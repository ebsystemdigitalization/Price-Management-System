import { useAuth, UserRole } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, Shield, Tag } from "lucide-react";

export default function Header() {
  const { currentUser, role, department, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const getRoleDisplayName = (r: UserRole) => {
    switch (r) {
      case "user": return "Requester";
      case "rank4": return "Rank 4 (Sales Head)";
      case "rank3": return "Rank 3 (ESP Head)";
      case "rank2": return "Rank 2 (CEBO)";
      case "rank1": return "Rank 1 (CFO)";
      case "admin": return "Super Admin";
      default: return r || "";
    }
  };

  return (
    <header className="w-full bg-gradient-to-r from-[#001872] to-[#009BDF] text-white shadow-sm print:hidden">
      <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between">
        {/* Brand — logo hidden for now. Flip {false && back to true to restore. */}
        <div
          className="flex items-center gap-2 cursor-pointer select-none"
          onClick={() => navigate("/")}
        >
          {false && <img src="/celcomdigi-logo.png" alt="CelcomDigi" className="h-8 w-auto" />}
        </div>

        {currentUser && (
          <div className="flex items-center gap-4">
            {/* Real Role Display — hidden for now per request. Flip {false &&
                back to true to restore it. */}
            {false && (
            <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/20 text-xs">
              <Shield className="h-3.5 w-3.5 text-yellow-300 animate-pulse" />
              <span className="text-white/75 font-medium hidden md:inline">Role:</span>
              <span className="font-bold text-white">{getRoleDisplayName(role)}</span>
            </div>
            )}

            {/* Resolved Department Display for Rank 4 */}
            {role === "rank4" && (
              <div className="flex items-center gap-2 bg-white/10 px-3 py-1.5 rounded-full border border-white/20 text-xs">
                <Tag className="h-3.5 w-3.5 text-orange-300" />
                <span className="text-white/75 font-medium hidden md:inline">Dept:</span>
                <span className="font-bold text-white">
                  {department === "Head of Enterprise Sales, Region" ? "Region" :
                   department === "Head of Enterprise Sales, Public Sector, GLCs & Named Accounts" ? "Public Sector, GLCs & Named Accounts" :
                   department === "Head of Enterprise Sales (Strategic & Corporate Accounts)" ? "Strategic & Corporate Accounts" :
                   department || "Unassigned"}
                </span>
              </div>
            )}

            <div className="hidden sm:block">
              <span className="text-sm font-medium">{currentUser.email}</span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-white hover:bg-white/15 hover:text-white gap-2"
            >
              <LogOut className="h-4 w-4" />
              Logout
            </Button>
          </div>
        )}
      </div>
    </header>
  );
}