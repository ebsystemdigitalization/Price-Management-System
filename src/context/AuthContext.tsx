import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { auth, db, functions, handleFirestoreError, OperationType } from "../firebase";

export type UserRole = "admin" | "user" | "rank4" | "rank3" | "rank2" | "rank1" | "viewer" | null;

interface AuthContextType {
  currentUser: User | null;
  role: UserRole;
  department: string | null;
  name: string | null;
  loading: boolean;
  logout: () => Promise<void>;
  updateDepartment: (newDept: string | null) => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  currentUser: null,
  role: null,
  department: null,
  name : null,
  loading: true,
  logout: async () => {},
  updateDepartment: async () => {},
});

export function useAuth() {
  return useContext(AuthContext);
}

export function getDepartmentFromEmail(email: string): string | null {
  const e = email.toLowerCase();
  if (e.includes("region")) {
    return "Head of Enterprise Sales, Region";
  }
  if (e.includes("public") || e.includes("glc") || e.includes("named")) {
    return "Head of Enterprise Sales, Public Sector, GLCs & Named Accounts";
  }
  if (e.includes("corporate") || e.includes("strategic") || e.includes("corp")) {
    return "Head of Enterprise Sales (Strategic & Corporate Accounts)";
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [actualRole, setActualRole] = useState<UserRole>(null);
  const [actualDepartment, setActualDepartment] = useState<string | null>(null);
  const [actualName, setActualName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
            if (user) {
        try {
          // Primary path: server-side getMyProfile function (works after the
          // firestore.rules lockdown, since it reads via the admin SDK).
          const getMyProfileFn = httpsCallable(functions, "getMyProfile");
          const result = await getMyProfileFn();
          const data = result.data as { role: UserRole; department: string | null; name: string | null };
          console.log(`[Auth] Loaded role "${data.role}" via getMyProfile`);
          setActualRole(data.role || "user");
          setActualDepartment(data.department ?? null);
          setActualName(data.name ?? null);
        } catch (fnErr) {
          // Fallback: direct Firestore read (current behavior). Keeps login
          // working if the function is unavailable. This fallback stops working
          // once firestore.rules are locked down — by then getMyProfile is proven.
          console.warn("[Auth] getMyProfile failed, falling back to direct read:", fnErr);
          try {
            const docRef = doc(db, "users", user.uid);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists() && docSnap.data().role) {
              const role = docSnap.data().role as UserRole;
              setActualRole(role);
              const loadedDept = docSnap.data().department || null;
              setActualName(docSnap.data().name || null);
              if (role === "rank4" && !loadedDept && user.email) {
                setActualDepartment(getDepartmentFromEmail(user.email));
              } else {
                setActualDepartment(loadedDept);
              }
            } else if (user.email) {
              const emailDocRef = doc(db, "users", user.email);
              const emailDocSnap = await getDoc(emailDocRef);
              if (emailDocSnap.exists() && emailDocSnap.data().role) {
                const role = emailDocSnap.data().role as UserRole;
                setActualRole(role);
                const loadedDept = emailDocSnap.data().department || null;
                setActualName(emailDocSnap.data().name || null);
                if (role === "rank4" && !loadedDept) {
                  setActualDepartment(getDepartmentFromEmail(user.email));
                } else {
                  setActualDepartment(loadedDept);
                }
              } else if (user.email.toLowerCase().includes("rank4")) {
                setActualRole("rank4");
                setActualDepartment(getDepartmentFromEmail(user.email));
              } else {
                setActualRole("user");
                setActualDepartment(null);
              }
            } else {
              setActualRole("user");
              setActualDepartment(null);
            }
          } catch (err) {
            console.error("[Auth] Fallback read also failed:", err);
            setActualRole("user");
            setActualDepartment(null);
          }
        }
      } else {
        setActualRole(null);
        setActualDepartment(null);
        setActualName(null);
      }
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const logout = async () => {
    await signOut(auth);
  };

  // DEAD CODE — no component currently calls updateDepartment. It is exposed on
  // the context value below, but nothing in src/ consumes it (Header.tsx only
  // displays `department` for rank4; there is no edit control anywhere). Kept
  // for now rather than removed.
  //
  // Two things to fix before wiring it to any UI:
  //   1. The server-side updateMyDepartment callable now rejects any caller
  //      whose existing profile role is not "rank4", and rejects callers with
  //      no profile at all, so this will throw permission-denied for most users.
  //   2. The optimistic setActualDepartment below runs BEFORE the call and is
  //      never reverted on failure, so a rejected call leaves the UI showing a
  //      department the server did not accept (see FIND-40 in the threat model).
  const updateDepartment = async (newDept: string | null) => {
    if (!currentUser) return;
    setActualDepartment(newDept);
    try {
      const updateMyDepartmentFn = httpsCallable(functions, "updateMyDepartment");
      await updateMyDepartmentFn({ department: newDept });
    } catch (err) {
      console.error("[Auth] Error updating user department:", err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        role: actualRole,
        department: actualDepartment,
        name: actualName,
        loading,
        logout,
        updateDepartment,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}