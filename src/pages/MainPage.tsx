import React, { useMemo, useState } from "react";
import { Order } from "../types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Plus, Hash, Calendar, TrendingUp, Wallet, ArrowRight, LayoutDashboard, Trash2, Edit, History, Clock, Eye, FileText, Package, CheckCircle2, Copy } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "motion/react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import Header from "../components/Header";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "@/lib/utils";

interface MainPageProps {
  orders: Order[];
  onDeleteOrder?: (id: string) => void;
  onDuplicateOrder?: (order: Order) => void;
}

export default function MainPage({ orders, onDeleteOrder, onDuplicateOrder }: MainPageProps) {
  const { role } = useAuth();
  const navigate = useNavigate();
  const [orderToDelete, setOrderToDelete] = useState<string | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({});

  const groupedOrders = useMemo(() => {
    const groups: Record<string, Order[]> = {};
    orders.forEach(order => {
      if (!groups[order.orderNumber]) {
        groups[order.orderNumber] = [];
      }
      groups[order.orderNumber].push(order);
    });
    
    // Sort each group by version descending
    Object.keys(groups).forEach(key => {
      groups[key].sort((a, b) => (b.version || 1) - (a.version || 1));
    });
    
    return groups;
  }, [orders]);

  const latestOrders = useMemo(() => {
    return Object.values(groupedOrders)
      .map(group => group[0])
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [groupedOrders]);

  const toggleExpand = (orderNumber: string) => {
    setExpandedOrders(prev => ({
      ...prev,
      [orderNumber]: !prev[orderNumber]
    }));
  };

  const handleDeleteClick = (id: string) => {
    setOrderToDelete(id);
    setIsDeleteModalOpen(true);
  };

    const confirmDelete = () => {
    if (orderToDelete && onDeleteOrder) {
      onDeleteOrder(orderToDelete);
      setIsDeleteModalOpen(false);
      setOrderToDelete(null);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 font-sans">
      <Header />
      <div className="p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Page title / actions */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <LayoutDashboard className="h-8 w-8 text-primary" />
              Pricing Management System
            </h1>
            <p className="text-muted-foreground">
              
            </p>
          </div>
          {role === "user" && (
            <Button asChild size="lg" className="gap-2 bg-yellow-400 hover:bg-yellow-500 text-black border-none font-semibold shadow-sm">
              <Link to="/manage?new=1">
                <Plus className="h-5 w-5" />
                New FA Request
              </Link>
            </Button>
          )}
        </header>

        {/* Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total FA Requested</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{latestOrders.filter(o => (o.status || "Draft") !== "Draft").length}</div>
              <p className="text-xs text-muted-foreground">Unique order numbers</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Pending Approval</CardTitle>
              <Clock className="h-4 w-4 text-amber-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {latestOrders.filter(o => (o.status || "").startsWith("Pending Approval")).length}
              </div>
              <p className="text-xs text-muted-foreground">Awaiting a decision</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total FA Completed</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {latestOrders.filter(o => o.status === "Approved").length}
              </div>
              <p className="text-xs text-muted-foreground">Fully approved</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Completed TCV (RM)</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {latestOrders.filter(o => o.status === "Approved").reduce((acc, o) => acc + o.totalRevenue, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <p className="text-xs text-muted-foreground">Approved TCV only</p>
            </CardContent>
          </Card>
        </div>

        {/* Orders Table */}
        <Card>
          <CardHeader>
            <CardTitle>Confirmed FA Requests</CardTitle>
            <CardDescription>All confirmed FA requests. Expand to see version history.</CardDescription>
          </CardHeader>
          <CardContent>
            {latestOrders.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Package className="h-12 w-12 mx-auto mb-4 opacity-20" />
                <p>No confirmed FA request yet.</p>
                {role === "user" && (
                  <Button asChild variant="link" className="mt-2">
                    <Link to="/manage?new=1">Create your first pricing</Link>
                  </Button>
                )}
              </div>
            ) : (
              <div className="border rounded-lg overflow-auto max-h-[600px] visible-scrollbar [&>div]:overflow-visible">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-8"></TableHead>
                      <TableHead className="text-center">FA Request Number</TableHead>
                     <TableHead className="text-center">Company</TableHead>
                      <TableHead className="text-center">Revenue (RM)</TableHead>
                      <TableHead className="text-center">Cost (RM)</TableHead>
                      <TableHead className="text-center">Version</TableHead>
                      <TableHead className="text-center">Date</TableHead>
                      <TableHead className="text-center">Approval Status</TableHead>
                      <TableHead className="text-center">Actions</TableHead>
                      {role !== "user" && <TableHead className="text-center">Created By</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {latestOrders.map((order) => {
                      const history = groupedOrders[order.orderNumber];
                      const isExpanded = expandedOrders[order.orderNumber];
                      const hasHistory = history.length > 1;

                      return (
                        <React.Fragment key={order.id}>
                          <TableRow>
                            <TableCell>
                              {hasHistory && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => toggleExpand(order.orderNumber)}
                                >
                                  <History className="h-3 w-3" />
                                </Button>
                              )}
                            </TableCell>
                            <TableCell className="text-center font-mono font-medium">{order.orderNumber}</TableCell>
                            <TableCell className="text-center">{order.companyName || "-"}</TableCell>
                            <TableCell className="text-center">
                              {order.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell className="text-center">
                              {order.totalCost != null
                                ? order.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                : "-"}
                            </TableCell>
                            <TableCell className="text-center">
                              <Badge variant="outline">v{order.version || 1}</Badge>
                            </TableCell>
                            <TableCell className="text-center text-sm text-muted-foreground">
                              {formatDate(order.createdAt)}
                            </TableCell>
                            <TableCell className="text-left">
                              <Badge className={
                                order.status === "Approved"
                                  ? "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-emerald-200"
                                  : order.status === "Rejected"
                                  ? "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-rose-200"
                                  : order.status === "Pending Approval - Rank 4"
                                  ? "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-orange-200"
                                  : order.status === "Pending Approval - Rank 3"
                                  ? "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-purple-200"
                                  : order.status === "Pending Approval - Rank 2"
                                  ? "bg-pink-100 text-pink-800 border-pink-200 hover:bg-pink-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-pink-200"
                                  : order.status === "Pending Approval - Rank 1"
                                  ? "bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-teal-200"
                                  : order.status === "Submitted for Approval"
                                  ? "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-blue-200"
                                  : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-slate-200"
                              }>
                                {order.status === "Pending Approval - Rank 4" ? `Pending ${order.headOfDepartment || "Head of Sales"}` :
                                 order.status === "Pending Approval - Rank 3" ? "Pending Head of Commercial" :
                                 order.status === "Pending Approval - Rank 2" ? "Pending CEBO" :
                                 order.status === "Pending Approval - Rank 1" ? "Pending CFO" :
                                 order.status || "Draft"}
                              </Badge>
                            </TableCell>
                            <TableCell className="text-left">
                              <div className="flex items-center justify-start gap-1">
                                <Button variant="ghost" size="sm" asChild>
                                  <Link to={`/order-details?id=${order.id}`} className="gap-1">
                                    <Eye className="h-3 w-3" />
                                    {["rank1", "rank2", "rank3", "rank4"].includes(role || "") ? "Approval" : "View"}
                                  </Link>
                                </Button>
                                {role === "user" && order.status === "Draft" && (
                                  <Button variant="ghost" size="sm" asChild>
                                    <Link to={`/report?id=${order.id}`} className="gap-1">
                                      <Edit className="h-3 w-3" />
                                      Edit
                                    </Link>
                                  </Button>
                                )}
                                {role === "user" && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                      onDuplicateOrder?.(order);
                                      navigate("/manage");
                                    }}
                                  >
                                    <Copy className="h-3 w-3" />
                                  </Button>
                                )}
                                {role === "admin" && (
                                  <Button 
                                    variant="ghost" 
                                    size="sm" 
                                    className="text-destructive hover:text-destructive hover:bg-destructive/10"
                                    onClick={() => handleDeleteClick(order.id)}
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                            {role !== "user" && (
                              <TableCell className="text-center text-sm text-muted-foreground">{order.createdBy || "-"}</TableCell>
                            )}
                          </TableRow>

                          <AnimatePresence>
                            {isExpanded && hasHistory && history.slice(1).map((oldVersion) => (
                              <motion.tr
                                key={oldVersion.id}
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="bg-muted/20"
                              >
                                <TableCell></TableCell>
                                <TableCell className="text-center font-mono text-sm text-muted-foreground pl-8">
                                  <Clock className="h-3 w-3 inline mr-1" />
                                  {oldVersion.orderNumber}
                                </TableCell>
                                <TableCell className="text-center text-sm text-muted-foreground">{oldVersion.companyName || "-"}</TableCell>
                                <TableCell className="text-center text-sm text-muted-foreground">
                                 {oldVersion.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </TableCell>
                                <TableCell className="text-center text-sm text-muted-foreground">
                                  {oldVersion.totalCost != null
                                    ? oldVersion.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                    : "-"}
                                </TableCell>
                                <TableCell className="text-center">
                                  <Badge variant="outline" className="opacity-60">v{oldVersion.version || 1}</Badge>
                                </TableCell>
                                <TableCell className="text-center text-sm text-muted-foreground">
                                  {formatDate(oldVersion.createdAt)}
                                </TableCell>
                                <TableCell className="text-left">
                                  <Badge className={
                                    oldVersion.status === "Approved"
                                      ? "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                                      : oldVersion.status === "Submitted for Approval"
                                      ? "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                                      : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-100 text-xs font-semibold px-2.5 py-0.5 rounded-full"
                                  }>
                                    {oldVersion.status || "Draft"}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-left">
                                  <Button variant="ghost" size="sm" asChild>
                                    <Link to={`/order-details?id=${oldVersion.id}`} className="gap-1">
                                      <Eye className="h-3 w-3" />
                                      {["rank1", "rank2", "rank3", "rank4"].includes(role || "") ? "Approval" : "View"}
                                    </Link>
                                  </Button>
                                </TableCell>
                              </motion.tr>
                            ))}
                          </AnimatePresence>
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Delete Confirmation Dialog */}
        <Dialog open={isDeleteModalOpen} onOpenChange={setIsDeleteModalOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to delete this order? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setIsDeleteModalOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmDelete}>Delete Order</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </div>
  );
}