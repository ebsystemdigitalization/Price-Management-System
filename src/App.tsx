import { useState, useEffect, ReactNode } from "react";
import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import { Service, Order, OrderMetadata } from "./types";
import Dashboard from "./pages/Dashboard";
import SummaryReport from "./pages/SummaryReport";
import MainPage from "./pages/MainPage";
import OrderDetails from "./pages/OrderDetails";
import LoginUser from "./pages/LoginUser";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { useFirestoreOrders } from "./hooks/useFirestoreOrders";
import { db, functions, handleFirestoreError, OperationType } from "./firebase";
import { deleteDoc, doc } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { Toaster, toast } from "sonner";

import { INITIAL_METADATA } from "./types";

// Gate: redirect to /login when not authenticated. Waits for auth to resolve.
function RequireAuth({ children }: { children: ReactNode }) {
  const { currentUser, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
}

// Only "user" (Requester) role can access data entry / editing routes.
function RequireUser({ children }: { children: ReactNode }) {
  const { role, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (role !== "user") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

// Viewers (Account Manager / Head of Section) are read-only — block edit/report routes.
function BlockViewer({ children }: { children: ReactNode }) {
  const { role, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (role === "viewer") {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  // Drafts (in-progress services + metadata) live in localStorage, namespaced
  // per signed-in user (by UID) so switching accounts on the same browser
  // never leaks one user's unsaved draft into another user's session.
  const { currentUser } = useAuth();
  const uid = currentUser?.uid;

  const servicesKey = uid ? `services_${uid}` : null;
  const metadataKey = uid ? `orderMetadata_${uid}` : null;

  const [services, setServices] = useState<Service[]>([]);
  const [orderMetadata, setOrderMetadata] = useState<OrderMetadata>(INITIAL_METADATA);

  // (Re)load this user's own draft whenever the signed-in user changes
  // (login, logout, or switching accounts on the same browser).
  useEffect(() => {
    if (!servicesKey || !metadataKey || typeof window === 'undefined') {
      setServices([]);
      setOrderMetadata(INITIAL_METADATA);
      return;
    }

    const savedServices = localStorage.getItem(servicesKey);
    setServices(savedServices ? JSON.parse(savedServices) : []);

    const savedMetadata = localStorage.getItem(metadataKey);
    if (savedMetadata) {
      try {
        const parsed = JSON.parse(savedMetadata);
        const merged = { ...INITIAL_METADATA, ...parsed };
        if (!merged.cidbLevy) merged.cidbLevy = "No";
        if (!merged.stampDuty) merged.stampDuty = "No";
        if (!merged.ePerolehan) merged.ePerolehan = "No";
        setOrderMetadata(merged);
      } catch (e) {
        setOrderMetadata(INITIAL_METADATA);
      }
    } else {
      setOrderMetadata(INITIAL_METADATA);
    }
  }, [uid]);

  // Orders now come live from Firestore (role-filtered inside the hook).
  const { orders } = useFirestoreOrders();

  useEffect(() => {
    if (servicesKey) {
      localStorage.setItem(servicesKey, JSON.stringify(services));
    }
  }, [services, servicesKey]);

  useEffect(() => {
    if (metadataKey) {
      localStorage.setItem(metadataKey, JSON.stringify(orderMetadata));
    }
  }, [orderMetadata, metadataKey]);

  // Confirm -> write a new order document to Firestore.
  // Each confirm creates a new doc (history preserved), matching the original's
  // "always new ID" behavior. createdBy is stamped with the signed-in email here,
  // so SummaryReport's order-building logic doesn't need to change.
    const handleConfirmOrder = async (order: Order, reset: boolean = true) => {
    try {
      const createOrderFn = httpsCallable(functions, "createOrder");
      await createOrderFn({ order, isNew: reset });
    } catch (e: any) {
      console.error("Failed to save order:", e);
      const msg = e?.message || "Failed to save FA request. Please try again.";
      toast.error(msg);
      throw e; // re-throw so SummaryReport only shows success on a real save
    }

    if (reset) {
      setServices([]);
      setOrderMetadata(INITIAL_METADATA);
    }
  };

  const handleDuplicateOrder = (order: Order) => {
    // Copy every field to a fresh draft — company name and all other fields
    // included, per Aya's call. Attachments are intentionally cleared since
    // they're actual uploaded files tied to the original request, not just
    // text data. IDs on services are regenerated so they're treated as new
    // line items, not linked back to the source order.
    setOrderMetadata({
      servicesProducts: order.servicesProducts || "",
      companyName: order.companyName || "",
      projectBrief: order.projectBrief || "",
      justification: order.justification || "",
      accountManager: order.accountManager || "",
      regionalManager: order.regionalManager || "",
      headOfDepartment: order.headOfDepartment || "",
      pricer: order.pricer || "",
      solutionArchitect: order.solutionArchitect || "",
      salesforceId: order.salesforceId || "",
      vendorName: order.vendorName || "",
      businessDevelop: order.businessDevelop || "",
      preSales: order.preSales || "",
      cidbLevy: order.cidbLevy || "No",
      cidbLevyAmount: order.cidbLevyAmount || "0",
      stampDuty: order.stampDuty || "No",
      stampDutyAmount: order.stampDutyAmount || "0",
      ePerolehan: order.ePerolehan || "No",
      solutionServiceType: order.solutionServiceType || "",
      date: order.date || new Date().toISOString().split('T')[0],
      contractType: order.contractType || "New Contract",
      exchangeRate: order.exchangeRate || "1.00",
      option: order.option || "No",
      totalOneTimeChargeB2S: order.totalOneTimeChargeB2S || "0",
      totalUpfrontPayment: order.totalUpfrontPayment || "0",
      totalFinancingRequest: order.totalFinancingRequest || "0",
      financingLease: order.financingLease || "0",
      contractPeriod: order.contractPeriod || "",
      finalDecisionMaker: order.finalDecisionMaker || "",
      finalDecisionAuthorityRank: order.finalDecisionAuthorityRank || "",
      currency: order.currency || "Malaysian Ringgit",
      attachments: []
    });
    setServices(order.services.map(s => ({ ...s, id: crypto.randomUUID() })));
  };

    const handleDeleteOrder = async (orderId: string) => {
    try {
      const deleteOrderFn = httpsCallable(functions, "deleteOrder");
      await deleteOrderFn({ orderId });
      toast.success("FA Request deleted successfully");
    } catch (e: any) {
      console.error("Failed to delete order:", e);
      const msg = e?.message || "Failed to delete FA request. Please try again.";
      toast.error(msg);
    }
  };

  return (
    <Routes>
      <Route path="/login" element={<LoginUser />} />
      <Route
        path="/"
        element={
          <RequireAuth>
            <MainPage orders={orders} onDeleteOrder={handleDeleteOrder} onDuplicateOrder={handleDuplicateOrder} />
          </RequireAuth>
        }
      />
      <Route
        path="/manage"
        element={
          <RequireAuth>
            <RequireUser>
              <Dashboard services={services} setServices={setServices} metadata={orderMetadata} setMetadata={setOrderMetadata} />
            </RequireUser>
          </RequireAuth>
        }
      />
      <Route
        path="/report"
        element={
          <RequireAuth>
            <BlockViewer>
              <SummaryReport services={services} setServices={setServices} onConfirm={handleConfirmOrder} orders={orders} setOrders={() => {}} metadata={orderMetadata} setMetadata={setOrderMetadata} />
            </BlockViewer>
          </RequireAuth>
        }
      />
      <Route
        path="/order-details"
        element={
          <RequireAuth>
            <OrderDetails orders={orders} />
          </RequireAuth>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <Router>
      <AuthProvider>
        <AppRoutes />
        <Toaster richColors position="top-right" />
      </AuthProvider>
    </Router>
  );
}