import React, { useMemo, useState } from "react";
import { Order } from "../types";
import { formatDate, formatDateTime } from "@/lib/utils";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { FileText, Edit, Package, ArrowLeft, TrendingUp, Wallet, Hash, Calendar, Send, CheckCircle2, Clock, ThumbsUp, ThumbsDown, Check, X, ShieldCheck, FileSpreadsheet, Paperclip, Plus } from "lucide-react";
import Header from "../components/Header";
import ChangeHistory from "../components/ChangeHistory";
import { openAttachment } from "../lib/attachments";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { db, functions, handleFirestoreError, OperationType } from "../firebase";
import { httpsCallable } from "firebase/functions";
import { doc, updateDoc } from "firebase/firestore";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";


interface OrderDetailsProps {
  orders: Order[];
}

export default function OrderDetails({ orders }: OrderDetailsProps) {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get("id");
    const orderToView = useMemo(() => orders.find(o => o.id === orderId), [orders, orderId]);

  const previousVersion = useMemo(() => {
    if (!orderToView) return undefined;
    return orders
      .filter(o => o.orderNumber === orderToView.orderNumber && (o.version || 1) < (orderToView.version || 1))
      .sort((a, b) => (b.version || 1) - (a.version || 1))[0];
  }, [orders, orderToView]);
  const { role, currentUser, department } = useAuth();

  const [isSubmitDialogOpen, setIsSubmitDialogOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionNote, setSubmissionNote] = useState("");

  const [isApproving, setIsApproving] = useState(false);
  const [approvalComment, setApprovalComment] = useState("");

  const [isWithdrawDialogOpen, setIsWithdrawDialogOpen] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);

    const handleSubmitApproval = async () => {
    if (!orderToView) return;
    setIsSubmitting(true);
    try {
      const submitFn = httpsCallable(functions, "submitForApproval");
      await submitFn({ orderId: orderToView.id, submissionNote: submissionNote });
      toast.success("FA Request submitted for approval successfully!");
      setIsSubmitDialogOpen(false);
    } catch (err: any) {
      console.error("Error submitting order for approval:", err);
      const msg = err?.message || "Failed to submit for approval. Please try again.";
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

    const handleApproveAction = async () => {
    if (!orderToView || !currentUser) return;
    if (!approvalComment.trim()) {
      toast.error("Please add a comment before approving.");
      return;
    }
    setIsApproving(true);
    try {
      const approveOrderFn = httpsCallable(functions, "approveOrder");
      const result = await approveOrderFn({
        orderId: orderToView.id,
        comment: approvalComment.trim(),
      });
      const data = result.data as { success: boolean; roleName: string };
      toast.success(`FA Request has been successfully approved as ${data.roleName}!`);
      setApprovalComment("");
    } catch (err: any) {
      console.error("Error approving order:", err);
      // Cloud Function throws HttpsError with a readable message for auth failures.
      const msg = err?.message || "Failed to approve order. Please try again.";
      toast.error(msg);
    } finally {
      setIsApproving(false);
    }
  };

    const handleRejectAction = async () => {
    if (!orderToView || !currentUser) return;
    if (!approvalComment.trim()) {
      toast.error("Please add a comment before rejecting.");
      return;
    }
    setIsApproving(true);
    try {
      const rejectOrderFn = httpsCallable(functions, "rejectOrder");
      const result = await rejectOrderFn({
        orderId: orderToView.id,
        comment: approvalComment.trim(),
      });
      const data = result.data as { success: boolean; roleName: string };
      toast.success(`FA Request has been successfully rejected by ${data.roleName}.`);
      setApprovalComment("");
    } catch (err: any) {
      console.error("Error rejecting order:", err);
      const msg = err?.message || "Failed to reject order. Please try again.";
      toast.error(msg);
    } finally {
      setIsApproving(false);
    }
  };

  // Explicit withdrawal from an active review, requested by the creator only.
  // Keeps approvalHistory intact (any earlier-rank approvals stay on record)
  // and just returns the order to Draft so the normal Edit -> Update Report
  // flow (which already creates a fresh version) takes over from there.
    const handleWithdrawFromReview = async () => {
    if (!orderToView) return;
    setIsWithdrawing(true);
    try {
      const withdrawFn = httpsCallable(functions, "withdrawFromReview");
      await withdrawFn({ orderId: orderToView.id });
      toast.success("FA Request withdrawn from review. You can now edit and resubmit it.");
      setIsWithdrawDialogOpen(false);
      navigate(`/report?id=${orderToView.id}`);
    } catch (err: any) {
      console.error("Error withdrawing order from review:", err);
      const msg = err?.message || "Failed to withdraw. Please try again.";
      toast.error(msg);
    } finally {
      setIsWithdrawing(false);
    }
  };

  // Sum of one-time (Part A) cost + SST across all services — used to pro-rate
  // financing lease across services in the finance tables.
  const oneTimeCostWithSST = useMemo(() => {
    if (!orderToView) return 0;
    return orderToView.services.reduce((acc, s) => {
      if (s.category === 'one-time') {
        return acc + s.totalCost + s.totalSST;
      }
      return acc;
    }, 0);
  }, [orderToView]);

  const orderPricingSummary = useMemo(() => {
    if (!orderToView) return { totalUpfront: 0, totalInstallment: 0, totalTCV: 0 };
    const totalUpfront = orderToView.services.reduce((acc, s) => acc + s.outrightPrice, 0);
    const totalInstallment = Math.round(orderToView.services.reduce((acc, s) => acc + s.monthlyRevenue, 0));
    const totalTCV = orderToView.services.reduce((acc, s) => {
      const serviceTcv = s.decision === "Installment Plan" 
        ? (s.totalInstallmentPayment || s.monthlyRevenue * s.installmentPeriod) 
        : (s.outrightPrice * s.installmentPeriod);
      return acc + serviceTcv;
    }, 0);
    return {
      totalUpfront,
      totalInstallment,
      totalTCV
    };
  }, [orderToView]);

  const orderCostingSummary = useMemo(() => {
    if (!orderToView) return { 
      upfront: { cost: 0, sst: 0, total: 0 }, 
      installment: { cost: 0, sst: 0, total: 0 },
      tcv: { cost: 0, sst: 0, total: 0 }
    };
    return orderToView.services.reduce((acc, s) => {
      if (s.category === "one-time") {
        acc.upfront.cost += s.totalCost;
        acc.upfront.sst += s.totalSST;
        acc.upfront.total += (s.totalCost + s.totalSST);
      } else if (s.category === "annual") {
        acc.installment.cost += s.totalCost;
        acc.installment.sst += s.totalSST;
        acc.installment.total += (s.totalCost + s.totalSST);
      }
      acc.tcv.cost = acc.upfront.cost + acc.installment.cost;
      acc.tcv.sst = acc.upfront.sst + acc.installment.sst;
      acc.tcv.total = acc.upfront.total + acc.installment.total;
      return acc;
    }, { 
      upfront: { cost: 0, sst: 0, total: 0 }, 
      installment: { cost: 0, sst: 0, total: 0 },
      tcv: { cost: 0, sst: 0, total: 0 }
    });
  }, [orderToView]);

  const pricerMarginSummary = useMemo(() => {
    const outrightPurchasePrice = orderToView?.totalRevenue || 0;
    const totalCostWithSST = orderCostingSummary.tcv.total || 0;
    
    const cidbLevyPercent = orderToView?.cidbLevy === "Yes" ? parseFloat(orderToView.cidbLevyAmount || "0") : 0;
    const stampDutyPercent = orderToView?.stampDuty === "Yes" ? parseFloat(orderToView.stampDutyAmount || "0") : 0;
    
    let ePerolehanPercent = 0;
    if (orderToView?.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
    else if (orderToView?.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

    const cidbLevyAmount = (outrightPurchasePrice * cidbLevyPercent) / 100;
    const stampDutyAmount = (outrightPurchasePrice * stampDutyPercent) / 100;
    const ePerolehanAmount = (outrightPurchasePrice * ePerolehanPercent) / 100;
    
    const rawGrossMarginRM = outrightPurchasePrice - totalCostWithSST;
    const grossMarginRM = rawGrossMarginRM;
    const grossMarginPercentage = outrightPurchasePrice !== 0 ? (grossMarginRM / outrightPurchasePrice) * 100 : 0;
    
    const leaseOption = orderToView?.option;
    const leaseFinancing = parseFloat(orderToView?.financingLease || "0");
    const leaseContract = parseInt(orderToView?.contractPeriod || "0");
    const totalFinancingLease = leaseOption === "No" ? 0 : leaseFinancing * leaseContract;

    const commissionAmount = (rawGrossMarginRM - (cidbLevyAmount + stampDutyAmount + ePerolehanAmount)) * 0.0685;
    const totalOpexRM = cidbLevyAmount + stampDutyAmount + ePerolehanAmount + commissionAmount + totalFinancingLease;

    const ebitdaMarginRM = grossMarginRM - totalOpexRM;
    const ebitdaMarginPercentage = outrightPurchasePrice !== 0 ? (ebitdaMarginRM / outrightPurchasePrice) * 100 : 0;

    const netMarginRM = ebitdaMarginRM - (ebitdaMarginRM > 0 ? ebitdaMarginRM * 0.24 : 0);
    const netMarginPercentage = outrightPurchasePrice !== 0 ? (netMarginRM / outrightPurchasePrice) * 100 : 0;

    return {
      outrightPurchasePrice,
      totalCostWithSST,
      grossMarginRM,
      grossMarginPercentage,
      cidbLevyPercent,
      cidbLevyAmount,
      stampDutyPercent,
      stampDutyAmount,
      ePerolehanPercent,
      ePerolehanAmount,
      commissionAmount,
      totalOpexRM,
      ebitdaMarginRM,
      ebitdaMarginPercentage,
      netMarginRM,
      netMarginPercentage
    };
  }, [orderToView, orderCostingSummary]);

  if (!orderToView) {
    return (
      <div className="min-h-screen bg-muted/30 font-sans">
        <Header />
        <div className="flex flex-col items-center justify-center p-4" style={{ minHeight: "calc(100vh - 64px)" }}>
          <h2 className="text-xl font-semibold mb-4">Order not found</h2>
          <Button asChild>
            <Link to="/">Back to Portal</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 font-sans">
      <Header />
      <div className="p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="flex items-center justify-between print:hidden">
          <Button variant="ghost" className="gap-2" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          {role === "user" && orderToView.status === "Draft" ? (
            <Button asChild>
              <Link to={`/report?id=${orderToView.id}`}>
                <Edit className="mr-2 h-4 w-4" />
                Edit Request
              </Link>
            </Button>
          ) : role === "user" ? null : false ? (
            <Button asChild variant="outline">
              <Link to={`/report?id=${orderToView.id}`}>
                <FileText className="mr-2 h-4 w-4" />
                Combined Summary Report
              </Link>
            </Button>
          ) : null}
        </div>

        <Card className="flex flex-col overflow-hidden">
          <CardHeader className="p-6 pb-2 shrink-0">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle className="text-2xl flex flex-wrap items-center gap-2">
                  <FileText className="h-6 w-6 text-primary" />
                  FA Request Details: {orderToView.orderNumber}
                  <Badge className="bg-yellow-100 text-yellow-800 border-yellow-300 text-2xl font-semibold px-6 py-4 rounded-full border">
                    v{orderToView.version || 1}
                  </Badge>
                  <Badge className={
                    orderToView.status === "Approved"
                      ? "bg-emerald-100 text-emerald-800 border-emerald-200 hover:bg-emerald-100 text-2xl font-semibold px-6 py-4 rounded-full border border-emerald-200"
                      : orderToView.status === "Rejected"
                      ? "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100 text-2xl font-semibold px-6 py-4 rounded-full border border-rose-200"
                      : orderToView.status === "Pending Approval - Rank 4"
                      ? "bg-orange-100 text-orange-800 border-orange-200 hover:bg-orange-100 text-2xl font-semibold px-6 py-4 rounded-full border border-orange-200"
                      : orderToView.status === "Pending Approval - Rank 3"
                      ? "bg-purple-100 text-purple-800 border-purple-200 hover:bg-purple-100 text-2xl font-semibold px-6 py-4 rounded-full border border-purple-200"
                      : orderToView.status === "Pending Approval - Rank 2"
                      ? "bg-pink-100 text-pink-800 border-pink-200 hover:bg-pink-100 text-2xl font-semibold px-6 py-4 rounded-full border border-pink-200"
                      : orderToView.status === "Pending Approval - Rank 1"
                      ? "bg-teal-100 text-teal-800 border-teal-200 hover:bg-teal-100 text-2xl font-semibold px-6 py-4 rounded-full border border-teal-200"
                      : orderToView.status === "Submitted for Approval"
                      ? "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 text-2xl font-semibold px-6 py-4 rounded-full border border-blue-200"
                      : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-100 text-2xl font-semibold px-6 py-4 rounded-full border border-slate-200"
                  }>
                    {orderToView.status === "Pending Approval - Rank 4" ? `Pending ${orderToView.headOfDepartment || "Head of Sales"}` :
                     orderToView.status === "Pending Approval - Rank 3" ? "Pending Head of Commercial" :
                     orderToView.status === "Pending Approval - Rank 2" ? "Pending CEBO" :
                     orderToView.status === "Pending Approval - Rank 1" ? "Pending CFO" :
                     orderToView.status || "Draft"}
                  </Badge>
                </CardTitle>
                                <CardDescription>
                  Confirmed on {formatDateTime(orderToView.createdAt)}
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          
          <Separator className="shrink-0" />
          
          <CardContent className="p-6 space-y-8">
            <div className="space-y-8">
              {/* Summary Cards — hidden for now. Flip {false && back to true to restore. */}
              {false && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="bg-primary/5 border-primary/10">
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground uppercase font-semibold mb-1">Total Revenue</div>
                    <div className="text-3xl font-bold text-primary">RM {orderToView.totalRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </CardContent>
                </Card>
                <Card className="bg-muted/50 border-muted">
                  <CardContent className="p-4">
                    <div className="text-sm text-muted-foreground uppercase font-semibold mb-1">Total Cost</div>
                    <div className="text-3xl font-bold">RM {orderToView.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  </CardContent>
                </Card>
              </div>
              )}

              {/* Project Information */}
              <div className="space-y-4">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Request Information</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-muted/20 rounded-lg border">
                  <div>
                    <div className="text-xs text-muted-foreground">Company Name</div>
                    <div className="text-sm font-medium">{orderToView.companyName || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Account Manager</div>
                    <div className="text-sm font-medium">{orderToView.accountManager || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Regional Manager</div>
                    <div className="text-sm font-medium">{orderToView.regionalManager || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Head of Department</div>
                    <div className="text-sm font-medium">{orderToView.headOfDepartment || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Pricer</div>
                    <div className="text-sm font-medium">{orderToView.pricer || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Solution Architect</div>
                    <div className="text-sm font-medium">{orderToView.solutionArchitect || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">S/ Force/ FA ID</div>
                    <div className="text-sm font-medium">{orderToView.salesforceId || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Vendor Name</div>
                    <div className="text-sm font-medium">{orderToView.vendorName || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Business Development</div>
                    <div className="text-sm font-medium">{orderToView.businessDevelop || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Pre-Sales</div>
                    <div className="text-sm font-medium">{orderToView.preSales || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">CIDB Levy</div>
                    <div className="text-sm font-medium">{orderToView.cidbLevy || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Stamp Duty</div>
                    <div className="text-sm font-medium">{orderToView.stampDuty || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">E-Perolehan</div>
                    <div className="text-sm font-medium">{orderToView.ePerolehan || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Solution Service Type</div>
                    <div className="text-sm font-medium">{orderToView.solutionServiceType || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Services/Products</div>
                    <div className="text-sm font-medium">{orderToView.servicesProducts || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Contract Type</div>
                    <Badge variant="outline" className="mt-1">{orderToView.contractType || "-"}</Badge>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Currency</div>
                    <div className="text-sm font-medium">{orderToView.currency || "-"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Exchange Rate</div>
                    <div className="text-sm font-medium">{orderToView.exchangeRate || "1.00"}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">Date</div>
                    <div className="text-sm font-medium">{orderToView.date ? formatDate(orderToView.date) : "-"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">Project Brief</div>
                    <div className="text-sm">{orderToView.projectBrief || "-"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground">Justification</div>
                    <div className="text-sm">{orderToView.justification || "-"}</div>
                  </div>
                  <div className="md:col-span-2">
                    <div className="text-xs text-muted-foreground flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </div>
                    {orderToView.attachments && orderToView.attachments.length > 0 ? (
                      <div className="space-y-1.5 mt-1">
                        {orderToView.attachments.map((attachment) => (
                          <button
                            key={attachment.id}
                            type="button"
                            onClick={() =>
                              openAttachment({
                                mode: "order",
                                orderId: orderToView.id,
                                attachmentId: attachment.id,
                              }).catch((e) =>
                                toast.error(e?.message || "Could not open attachment.")
                              )
                            }
                            className="w-full text-left flex items-center gap-2 text-sm border p-2 rounded bg-muted/20 hover:bg-muted/40 transition-colors"
                          >
                            {attachment.type === "pdf" ? (
                              <FileText className="h-4 w-4 text-red-600 shrink-0" />
                            ) : (
                              <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />
                            )}
                            <span className="font-medium hover:underline truncate">{attachment.name}</span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="text-sm">-</div>
                    )}
                  </div>
                </div>
              </div>

              {/* Summary of Pricing & Costing Side by Side — Costing hidden from viewer (Account Manager) */}
              <div className={`grid grid-cols-1 ${role !== "viewer" ? "lg:grid-cols-2" : ""} gap-6 border-t pt-8`}>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <TrendingUp className="h-4 w-4 text-primary" />
                      Pricing Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                      <div className="text-[10px] uppercase text-muted-foreground">Total Revenue</div>
                      <div className="text-lg font-bold text-primary">RM {orderPricingSummary.totalTCV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Upfront Price</div>
                        <div className="font-semibold">RM {orderPricingSummary.totalUpfront.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase text-muted-foreground">Monthly Rev</div>
                        <div className="font-semibold">RM {orderPricingSummary.totalInstallment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {role !== "viewer" && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Wallet className="h-4 w-4 text-primary" />
                      Costing Summary
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-3 rounded-lg bg-muted/50 border">
                      <div className="text-[10px] uppercase text-muted-foreground">Overall Total Cost (SST)</div>
                      <div className="text-lg font-bold">RM {orderCostingSummary.tcv.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Overall Total Cost (without SST)</div>
                          <div className="text-xs font-semibold">RM {orderCostingSummary.tcv.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Overall SST</div>
                          <div className="text-xs font-semibold">RM {orderCostingSummary.tcv.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50 border">
                      <div className="text-[10px] uppercase text-muted-foreground">Total(RM)-One Time Cost Services</div>
                      <div className="text-lg font-bold">RM {orderCostingSummary.upfront.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Total Cost</div>
                          <div className="text-xs font-semibold">RM {orderCostingSummary.upfront.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Total SST</div>
                          <div className="text-xs font-semibold">RM {orderCostingSummary.upfront.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-muted/50 border">
                      <div className="text-[10px] uppercase text-muted-foreground">Total(RM)-Annual Services Cost</div>
                      <div className="text-lg font-bold">RM {orderCostingSummary.installment.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Total Cost</div>
                          <div className="text-xs font-semibold">RM {orderCostingSummary.installment.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Total SST</div>
                          <div className="text-xs font-semibold">RM {orderCostingSummary.installment.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                )}
              </div>

              {/* Finance & admin: prominent side-by-side style, includes Commission */}
              {(role === "admin" || role === "rank1") && (
              <div className="space-y-4 border-t pt-8">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Financial Analysis (Internal)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-semibold uppercase text-primary/70">Gross Margin</CardTitle>
                      <TrendingUp className="h-4 w-4 text-primary opacity-70" />
                    </CardHeader>
                    <CardContent className="py-2 px-4 flex items-baseline justify-between flex-wrap">
                      <div className="text-xl font-bold text-primary">
                        RM {pricerMarginSummary.grossMarginRM.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xl font-bold text-primary/60">
                        {pricerMarginSummary.grossMarginPercentage.toFixed(2)}%
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-emerald-50 border-emerald-200">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-semibold uppercase text-emerald-700">EBITDA Margin</CardTitle>
                      <Wallet className="h-4 w-4 text-emerald-600 opacity-70" />
                    </CardHeader>
                    <CardContent className="py-2 px-4 flex items-baseline justify-between flex-wrap">
                      <div className="text-xl font-bold text-emerald-700">
                        RM {pricerMarginSummary.ebitdaMarginRM.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xl font-bold text-emerald-600">
                        {pricerMarginSummary.ebitdaMarginPercentage.toFixed(2)}%
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-rose-50 border-rose-200">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-semibold uppercase text-rose-700">Net Margin</CardTitle>
                      <Wallet className="h-4 w-4 text-rose-600 opacity-70" />
                    </CardHeader>
                    <CardContent className="py-2 px-4 flex items-baseline justify-between flex-wrap">
                      <div className="text-xl font-bold text-rose-700">
                        RM {pricerMarginSummary.netMarginRM.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xl font-bold text-rose-700">
                        {pricerMarginSummary.netMarginPercentage.toFixed(2)}%
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-amber-50 border-amber-200">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-semibold uppercase text-amber-700">Sales Commission</CardTitle>
                      <Wallet className="h-4 w-4 text-amber-600 opacity-70" />
                    </CardHeader>
                    <CardContent className="py-2 px-4 flex items-start justify-between flex-wrap">
                      <div className="text-xl font-bold text-amber-700">
                        RM {pricerMarginSummary.commissionAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <div className="text-right">
                        <p className="text-xl font-bold text-amber-700">
                          6.85%
                        </p>
                        <p className="text-[10px] text-amber-600 font-medium">
                          of (GM - OPEX)
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
              )}

              {/* Other approver roles: original stacked style, no Commission */}
              {(role === "user" || role === "rank2" || role === "rank3" || role === "rank4") && (
              <div className="space-y-4 border-t pt-8">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Financial Analysis (Internal)</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  <Card className="bg-primary/5 border-primary/20">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-semibold uppercase text-primary/70">Gross Margin</CardTitle>
                      <TrendingUp className="h-4 w-4 text-primary opacity-70" />
                    </CardHeader>
                    <CardContent className="py-2 px-4 flex items-baseline justify-between flex-wrap">
                      <div className="text-xl font-bold text-primary">
                        RM {pricerMarginSummary.grossMarginRM.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xl font-bold text-primary/60">
                        {pricerMarginSummary.grossMarginPercentage.toFixed(2)}%
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-emerald-50 border-emerald-200">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-semibold uppercase text-emerald-700">EBITDA Margin</CardTitle>
                      <Wallet className="h-4 w-4 text-emerald-600 opacity-70" />
                    </CardHeader>
                    <CardContent className="py-2 px-4 flex items-baseline justify-between flex-wrap">
                      <div className="text-xl font-bold text-emerald-700">
                        RM {pricerMarginSummary.ebitdaMarginRM.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xl font-bold text-emerald-600">
                        {pricerMarginSummary.ebitdaMarginPercentage.toFixed(2)}%
                      </p>
                    </CardContent>
                  </Card>

                  <Card className="bg-rose-50 border-rose-200">
                    <CardHeader className="py-3 px-4 flex flex-row items-center justify-between space-y-0">
                      <CardTitle className="text-xs font-semibold uppercase text-rose-700">Net Margin</CardTitle>
                      <Wallet className="h-4 w-4 text-rose-600 opacity-70" />
                    </CardHeader>
                    <CardContent className="py-2 px-4 flex items-baseline justify-between flex-wrap">
                      <div className="text-xl font-bold text-rose-700">
                        RM {pricerMarginSummary.netMarginRM.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                      <p className="text-xl font-bold text-rose-700">
                        {pricerMarginSummary.netMarginPercentage.toFixed(2)}%
                      </p>
                    </CardContent>
                  </Card>
                </div>
              </div>
              )}

              {/* Final Decision Maker */}
              <div className="space-y-4 border-t pt-8">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Final Decision Maker</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-3 bg-muted/50 rounded-lg border">
                    <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Final Decision Maker</div>
                    <div className="text-lg font-bold text-primary">{orderToView.finalDecisionMaker || "-"}</div>
                  </div>
                </div>

                <div className="mt-6 pt-4 border-t space-y-3">
                  <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Required Approval Workflow</h5>
                  {(() => {
                    const rank = orderToView.finalDecisionAuthorityRank || "";
                    const headOfSalesRole = orderToView.headOfDepartment || "Head of Sales";
                    let steps: { rank: string; role: string; desc: string }[] = [];

                    if (rank.includes("Rank 1")) {
                      steps = [
                        { rank: "Rank 4", role: headOfSalesRole, desc: "Initial Approval" },
                        { rank: "Rank 3", role: "Head of Commercial", desc: "Mid-level Review" },
                        { rank: "Rank 2", role: "CEBO", desc: "Executive Endorsement" },
                        { rank: "Rank 1", role: "CFO", desc: "Final Financial Approval" }
                      ];
                    } else if (rank.includes("Rank 2")) {
                      steps = [
                        { rank: "Rank 4", role: headOfSalesRole, desc: "Initial Approval" },
                        { rank: "Rank 3", role: "Head of Commercial", desc: "Mid-level Review" },
                        { rank: "Rank 2", role: "CEBO", desc: "Final Executive Approval" }
                      ];
                    } else if (rank.includes("Rank 3")) {
                      steps = [
                        { rank: "Rank 4", role: headOfSalesRole, desc: "Initial Review" },
                        { rank: "Rank 3", role: "Head of Commercial", desc: "Final Departmental Approval" }
                      ];
                    } else {
                      steps = [
                        { rank: "Rank 4", role: headOfSalesRole, desc: "Direct Final Approval" }
                      ];
                    }

                    return (
                      <div className="space-y-4 animate-fade-in">
                        <div className="flex flex-wrap gap-4 items-center">
                          {steps.map((step, idx) => {
                            const isApproved = (orderToView.approvalHistory || []).some(
                              (h) => h.rank === step.rank && h.status === "Approved"
                            );
                            
                            const isRejected = (orderToView.approvalHistory || []).some(
                              (h) => h.rank === step.rank && h.status === "Rejected"
                            );

                            const isCurrentPending = orderToView.currentApprovalRank === step.rank;

                            let borderClass = "border-muted-foreground/20 bg-background opacity-60";
                            let iconBgClass = "bg-muted text-muted-foreground";
                            let statusLabel = "Waiting";

                            if (isApproved) {
                              borderClass = "border-emerald-500 bg-emerald-50/20 opacity-100";
                              iconBgClass = "bg-emerald-500 text-white";
                              statusLabel = "Approved";
                            } else if (isRejected) {
                              borderClass = "border-rose-500 bg-rose-50/20 opacity-100";
                              iconBgClass = "bg-rose-500 text-white";
                              statusLabel = "Rejected";
                            } else if (isCurrentPending) {
                              borderClass = "border-primary bg-primary/5 ring-2 ring-primary/20 animate-pulse opacity-100";
                              iconBgClass = "bg-primary text-white";
                              statusLabel = "Pending Decision";
                            }

                            return (
                              <div key={step.rank} className="flex items-center gap-4">
                                {idx > 0 && (
                                  <div className="text-muted-foreground font-bold text-lg">➔</div>
                                )}
                                <div className={`flex items-center gap-3 p-2.5 border rounded-lg shadow-sm transition-all duration-300 ${borderClass}`}>
                                  <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${iconBgClass}`}>
                                    {step.rank.replace("Rank ", "")}
                                  </span>
                                  <div>
                                    <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                                      {step.role}
                                      {isApproved && <span className="text-[10px] text-emerald-600 font-bold">●</span>}
                                      {isCurrentPending && <span className="text-[10px] text-primary font-bold animate-ping">●</span>}
                                    </div>
                                    {false && <div className="text-[10px] text-muted-foreground">{step.desc} ({statusLabel})</div>}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Approval Audit Log */}
                        {orderToView.approvalHistory && orderToView.approvalHistory.length > 0 && (
                          <div className="mt-6 pt-4 border-t space-y-3">
                            <h6 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">Approval Audit Log</h6>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {orderToView.approvalHistory.map((history, hIdx) => (
                                <div key={hIdx} className={`p-3 border rounded-lg text-xs flex flex-col justify-between gap-2 shadow-sm ${
                                  history.status === "Approved" ? "bg-emerald-50/10 border-emerald-500/20" : "bg-rose-50/10 border-rose-500/20"
                                }`}>
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${
                                        history.status === "Approved" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                                      }`}>
                                        {history.rank.replace("Rank ", "")}
                                      </span>
                                      <span className="font-semibold text-foreground">{history.role}</span>
                                    </div>
                                    <span className={`font-bold px-1.5 py-0.5 rounded text-[10px] uppercase ${
                                      history.status === "Approved" ? "bg-emerald-100 text-emerald-800" : "bg-rose-100 text-rose-800"
                                    }`}>
                                      {history.status}
                                    </span>
                                  </div>
                                  
                                  {history.comment && (
                                    <p className="italic text-muted-foreground bg-muted/30 p-1.5 rounded border border-muted-foreground/10 text-[11px] my-1">
                                      "{history.comment}"
                                    </p>
                                  )}

                                  <div className="text-[10px] text-muted-foreground text-right border-t pt-1.5 mt-1 flex justify-between items-center">
                                    <span>By: {history.approvedBy}</span>
                                    <span>{formatDateTime(history.approvedAt)}</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Service List */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  List of Services ({orderToView.services.length} items)
                </h3>
                <div className="border rounded-lg overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/50">
                      <TableRow>
                        <TableHead>No</TableHead>
                        <TableHead>Services Name</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead>Service Types</TableHead>
                        <TableHead>No of units</TableHead>
                        <TableHead>No of years</TableHead>
                        <TableHead>Outright Purchase Price</TableHead>
                        <TableHead>Monthly Installment Revenue</TableHead>
                        <TableHead>Decision</TableHead>
                        <TableHead>Installment contract period (months)</TableHead>
                        {role !== "viewer" && <TableHead>Cost/unit</TableHead>}
                        {role !== "viewer" && <TableHead>Total cost</TableHead>}
                        {role !== "viewer" && <TableHead>Total SST (RM)</TableHead>}
                        {role !== "viewer" && <TableHead>Sales Buffer %</TableHead>}
                        <TableHead>Entity</TableHead>
                        <TableHead>Level of Authority</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {orderToView.services.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={role !== "viewer" ? 16 : 12} className="h-24 text-center text-muted-foreground">
                            No services found.
                          </TableCell>
                        </TableRow>
                      ) : (
                        orderToView.services.map((service, index) => (
                          <TableRow key={service.id}>
                            <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                            <TableCell className="font-medium">{service.name}</TableCell>
                            <TableCell className="max-w-[200px] truncate" title={service.description}>
                              {service.description}
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">{service.serviceType}</Badge>
                            </TableCell>
                            <TableCell>{service.units}</TableCell>
                            <TableCell>{service.years}</TableCell>
                            <TableCell>
                              {service.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              {service.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            <TableCell>
                              <Badge variant={service.decision === "Approved" ? "default" : service.decision === "Rejected" ? "destructive" : "outline"}>
                                {service.decision}
                              </Badge>
                            </TableCell>
                            <TableCell>{service.installmentPeriod}</TableCell>
                            {role !== "viewer" && (
                            <TableCell>
                              {service.costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            )}
                            {role !== "viewer" && (
                            <TableCell>
                              {service.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            )}
                            {role !== "viewer" && (
                            <TableCell>
                              {service.totalSST.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                            )}
                            {role !== "viewer" && <TableCell>{service.salesBuffer.toFixed(2)}%</TableCell>}
                            <TableCell>{service.entity}</TableCell>
                            <TableCell>
                              <Badge variant="outline" className="font-normal">
                                {service.authorityLevel}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </div>
              </div>

              {/* What Changed in This Version */}
              <div className="space-y-4 border-t pt-8">
                <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">What Changed in This Version</h4>
                <ChangeHistory current={orderToView} previous={previousVersion} />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Finance Calculation Data tables — admin and Finance (rank1) only */}
        {(role === "admin" || role === "rank1") && (
        <div className="max-w-6xl mx-auto space-y-8 px-4 md:px-8 pb-8 print:hidden">
        {/* FINANCING - Reselling Third Parties Services */}
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">FINANCING - Reselling Third Parties Services</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Option</div>
              <div className="text-lg font-bold text-primary">{orderToView.option || "-"}</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">+ Total One time charge B2S (RM)</div>
              <div className="text-lg font-bold text-primary">
                {orderToView.option === "No" ? "0.00" : parseFloat(orderToView.totalOneTimeChargeB2S || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">- Total Upfront payment (RM)</div>
              <div className="text-lg font-bold text-primary">
                {orderToView.option === "No" ? "0.00" : parseFloat(orderToView.totalUpfrontPayment || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">= Total financing request (RM)</div>
              <div className="text-lg font-bold text-primary">
                {orderToView.option === "No" ? "0.00" : parseFloat(orderToView.totalFinancingRequest || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Contract Period</div>
              <div className="text-lg font-bold text-primary">{orderToView.option === "No" ? "-" : (orderToView.contractPeriod || "-")}</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Financing lease (RM)</div>
              <div className="text-lg font-bold text-primary">
                {orderToView.option === "No" ? "0.00" : parseFloat(orderToView.financingLease || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg border">
              <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Total Financing lease (RM)</div>
              <div className="text-lg font-bold text-primary">
               {orderToView.option === "No" ? "0.00" : (parseFloat(orderToView.financingLease || "0") * parseInt(orderToView.contractPeriod || "0")).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>

        {/* Finance Calculation Data (Without Finance Lease) */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Finance Calculation Data (Without Finance Lease)</CardTitle>
              <CardDescription>Detailed financial calculations for inventory (Cash Purchase basis)</CardDescription>
            </div>
            <div className="flex gap-2 print:hidden">
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cat</TableHead>
                  <TableHead>Service Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Outright Purchase Price (RM)</TableHead>
                  <TableHead className="text-right">Monthly Installment Revenue (RM)</TableHead>
                  <TableHead className="text-right font-bold text-primary">Total Revenue (RM)</TableHead>
                  <TableHead className="text-right font-bold text-red-600">Total Cost (RM)</TableHead>
                  <TableHead className="text-right font-bold text-orange-600">Total Cost with SST (RM)</TableHead>
                  <TableHead className="text-right font-bold text-green-600">Gross Margin (RM)</TableHead>
                  <TableHead className="text-right font-bold text-blue-600">Gross Margin (%)</TableHead>
                  <TableHead className="text-right font-bold text-amber-600">CIDB Levy (RM)</TableHead>
                  <TableHead className="text-right font-bold text-indigo-600">Stamp Duty (RM)</TableHead>
                  <TableHead className="text-right font-bold text-purple-600">E-Perolehan (RM)</TableHead>
                  <TableHead className="text-right font-bold text-rose-600">Commission (RM)</TableHead>
                  <TableHead className="text-right font-bold text-emerald-600">Total Financing lease (RM)</TableHead>
                  <TableHead className="text-right font-bold text-slate-600">Total OPEX (RM)</TableHead>
                  <TableHead className="text-right font-bold text-teal-600">EBITDA (RM)</TableHead>
                  <TableHead className="text-right font-bold text-cyan-600">EBITDA Margin (%)</TableHead>
                  <TableHead className="text-right font-bold text-orange-600">Tax (RM)</TableHead>
                  <TableHead className="text-right font-bold text-pink-600">Net Margin (RM)</TableHead>
                  <TableHead className="text-right font-bold text-violet-600">Net Margin (%)</TableHead>
                  <TableHead className="text-right">Level of Authority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderToView.services.filter(s => s.decision === "Upfront Payment").map(s => {
                  const basePrice = Math.round(((s.totalCost + s.totalSST) / (1 - (s.salesBuffer || 0) / 100)) * 100) / 100;
                  const isInstallment = false;
                  const revenue = basePrice;
                  const currentTcv = basePrice;
                  const totalCostWithSST = s.totalCost + s.totalSST;
                  const cidbLevyPercent = orderToView.cidbLevy === "Yes" ? parseFloat(orderToView.cidbLevyAmount || "0") : 0;
                  const stampDutyPercent = orderToView.stampDuty === "Yes" ? parseFloat(orderToView.stampDutyAmount || "0") : 0;
                  
                  let ePerolehanPercent = 0;
                  if (orderToView.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
                  else if (orderToView.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

                  const sCidbLevyAmount = (revenue * cidbLevyPercent) / 100;
                  const sStampDutyAmount = (revenue * stampDutyPercent) / 100;
                  const sEPerolehanAmount = (revenue * ePerolehanPercent) / 100;

                  const sCommissionAmount = (currentTcv - (totalCostWithSST + sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount)) * 0.0685;
                  const sCostWithSSTForLease = s.category === 'one-time' ? (s.totalCost + s.totalSST) : 0;
                  const sTotalFinancingLease = oneTimeCostWithSST > 0
                    ? ((orderToView.option === "No" ? 0 : parseFloat(orderToView.financingLease || "0") * parseInt(orderToView.contractPeriod || "0")) * (sCostWithSSTForLease / oneTimeCostWithSST))
                    : 0;

                  const sTotalOpex = sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount + sCommissionAmount + sTotalFinancingLease;
                  const sEbitda = (currentTcv - (s.totalCost + s.totalSST)) - sTotalOpex;
                  const sTax = sEbitda > 0 ? sEbitda * 0.24 : 0;
                  const sNetMargin = sEbitda - sTax;

                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant={s.category === "one-time" ? "default" : "secondary"} className="text-[10px]">
                          {s.category === "one-time" ? "A" : "B"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-xs truncate max-w-[150px]">{s.name}</TableCell>
                      <TableCell className="text-xs">{s.serviceType}</TableCell>
                      <TableCell className="text-right text-xs">{basePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs">{s.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-primary">{currentTcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-red-600">{s.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-orange-600">{(s.totalCost + s.totalSST).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-green-600">{(currentTcv - (s.totalCost + s.totalSST)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-blue-600">
                        {currentTcv > 0 ? (Math.ceil(((currentTcv - (s.totalCost + s.totalSST)) / currentTcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-amber-600">{sCidbLevyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-indigo-600">{sStampDutyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-purple-600">{sEPerolehanAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-rose-600">{sCommissionAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-emerald-600">{sTotalFinancingLease.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-slate-600">{sTotalOpex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-teal-600">
                        {sEbitda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-cyan-600">
                        {currentTcv > 0 ? ((sEbitda / currentTcv * 100)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-orange-600">
                        {sTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-pink-600">
                        {sNetMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-violet-600">
                        {currentTcv > 0 ? ((sNetMargin / currentTcv * 100)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-[10px]">{s.authorityLevel}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                {(() => {
                  const totals = orderToView.services.filter(s => s.decision === "Upfront Payment").reduce((acc, s) => {
                    const basePrice = Math.round(((s.totalCost + s.totalSST) / (1 - (s.salesBuffer || 0) / 100)) * 100) / 100;
                    const revenue = basePrice;
                    const currentTcv = basePrice;
                    const totalCostWithSST = s.totalCost + s.totalSST;
                    const cidbLevyPercent = orderToView.cidbLevy === "Yes" ? parseFloat(orderToView.cidbLevyAmount || "0") : 0;
                    const stampDutyPercent = orderToView.stampDuty === "Yes" ? parseFloat(orderToView.stampDutyAmount || "0") : 0;
                    
                    let ePerolehanPercent = 0;
                    if (orderToView.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
                    else if (orderToView.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

                    const sCidbLevyAmount = (revenue * cidbLevyPercent) / 100;
                    const sStampDutyAmount = (revenue * stampDutyPercent) / 100;
                    const sEPerolehanAmount = (revenue * ePerolehanPercent) / 100;

                    const sCommissionAmount = (currentTcv - (totalCostWithSST + sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount)) * 0.0685;
                    const sCostWithSSTForLease = s.category === 'one-time' ? (s.totalCost + s.totalSST) : 0;
                    const sTotalFinancingLease = oneTimeCostWithSST > 0
                      ? ((orderToView.option === "No" ? 0 : parseFloat(orderToView.financingLease || "0") * parseInt(orderToView.contractPeriod || "0")) * (sCostWithSSTForLease / oneTimeCostWithSST))
                      : 0;

                    const sTotalOpex = sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount + sCommissionAmount + sTotalFinancingLease;
                    const grossMargin = currentTcv - (s.totalCost + s.totalSST);
                    const ebitda = grossMargin - sTotalOpex;
                    const tax = ebitda > 0 ? ebitda * 0.24 : 0;
                    const netMargin = ebitda - tax;

                    return {
                      outrightPrice: acc.outrightPrice + basePrice,
                      monthlyRevenue: acc.monthlyRevenue + s.monthlyRevenue,
                      tcv: acc.tcv + currentTcv,
                      totalCost: acc.totalCost + s.totalCost,
                      totalCostWithSST: acc.totalCostWithSST + totalCostWithSST,
                      grossMargin: acc.grossMargin + grossMargin,
                      cidbLevy: acc.cidbLevy + sCidbLevyAmount,
                      stampDuty: acc.stampDuty + sStampDutyAmount,
                      ePerolehan: acc.ePerolehan + sEPerolehanAmount,
                      commission: acc.commission + sCommissionAmount,
                      totalFinancingLease: acc.totalFinancingLease + sTotalFinancingLease,
                      totalOpex: acc.totalOpex + sTotalOpex,
                      ebitda: acc.ebitda + ebitda,
                      tax: acc.tax + tax,
                      netMargin: acc.netMargin + netMargin,
                    };
                  }, {
                    outrightPrice: 0,
                    monthlyRevenue: 0,
                    tcv: 0,
                    totalCost: 0,
                    totalCostWithSST: 0,
                    grossMargin: 0,
                    cidbLevy: 0,
                    stampDuty: 0,
                    ePerolehan: 0,
                    commission: 0,
                    totalFinancingLease: 0,
                    totalOpex: 0,
                    ebitda: 0,
                    tax: 0,
                    netMargin: 0,
                  });

                  const totalGMPercent = totals.tcv > 0 ? (totals.grossMargin / totals.tcv * 100) : 0;

                  return (
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={3} className="text-right">TOTAL</TableCell>
                      <TableCell className="text-right">{totals.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">{totals.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-primary">{totals.tcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-red-600">{totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-orange-600">{totals.totalCostWithSST.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-green-600">{totals.grossMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-blue-600">{(Math.ceil(totalGMPercent * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</TableCell>
                      <TableCell className="text-right text-amber-600">{totals.cidbLevy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-indigo-600">{totals.stampDuty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-purple-600">{totals.ePerolehan.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-rose-600">{totals.commission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-emerald-600">{totals.totalFinancingLease.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-slate-600">{totals.totalOpex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-teal-600">
                        {totals.ebitda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-cyan-600">
                        {totals.tcv > 0 ? (Math.ceil((totals.ebitda / totals.tcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {totals.tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-pink-600">
                        {totals.netMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-violet-600">
                        {totals.tcv > 0 ? (Math.ceil((totals.netMargin / totals.tcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  );
                })()}
              </TableFooter>
            </Table>
          </CardContent>
        </Card>


        {/* Finance Calculation Data (With Finance Lease) */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Finance Calculation Data (With Finance Lease)</CardTitle>
              <CardDescription>Detailed financial calculations for inventory</CardDescription>
            </div>
            <div className="flex gap-2 print:hidden">
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cat</TableHead>
                  <TableHead>Service Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Outright Purchase Price (RM)</TableHead>
                  <TableHead className="text-right">Monthly Installment Revenue (RM)</TableHead>
                  <TableHead className="text-right font-bold text-primary">Total Revenue (RM)</TableHead>
                  <TableHead className="text-right font-bold text-red-600">Total Cost (RM)</TableHead>
                  <TableHead className="text-right font-bold text-orange-600">Total Cost with SST (RM)</TableHead>
                  <TableHead className="text-right font-bold text-green-600">Gross Margin (RM)</TableHead>
                  <TableHead className="text-right font-bold text-blue-600">Gross Margin (%)</TableHead>
                  <TableHead className="text-right font-bold text-amber-600">CIDB Levy (RM)</TableHead>
                  <TableHead className="text-right font-bold text-indigo-600">Stamp Duty (RM)</TableHead>
                  <TableHead className="text-right font-bold text-purple-600">E-Perolehan (RM)</TableHead>
                  <TableHead className="text-right font-bold text-rose-600">Commission (RM)</TableHead>
                  <TableHead className="text-right font-bold text-emerald-600">Total Financing lease (RM)</TableHead>
                  <TableHead className="text-right font-bold text-slate-600">Total OPEX (RM)</TableHead>
                  <TableHead className="text-right font-bold text-teal-600">EBITDA (RM)</TableHead>
                  <TableHead className="text-right font-bold text-cyan-600">EBITDA Margin (%)</TableHead>
                  <TableHead className="text-right font-bold text-orange-600">Tax (RM)</TableHead>
                  <TableHead className="text-right font-bold text-pink-600">Net Margin (RM)</TableHead>
                  <TableHead className="text-right font-bold text-violet-600">Net Margin (%)</TableHead>
                  <TableHead className="text-right">Level of Authority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderToView.services.filter(s => s.decision === "Installment Plan").map(s => {
                  const isInstallment = s.decision === "Installment Plan";
                  const revenue = isInstallment ? s.totalInstallmentPayment : s.outrightPrice;
                  const totalCostWithSST = s.totalCost + s.totalSST;
                  const cidbLevyPercent = orderToView.cidbLevy === "Yes" ? parseFloat(orderToView.cidbLevyAmount || "0") : 0;
                  const stampDutyPercent = orderToView.stampDuty === "Yes" ? parseFloat(orderToView.stampDutyAmount || "0") : 0;
                  
                  let ePerolehanPercent = 0;
                  if (orderToView.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
                  else if (orderToView.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

                  const sCidbLevyAmount = (revenue * cidbLevyPercent) / 100;
                  const sStampDutyAmount = (revenue * stampDutyPercent) / 100;
                  const sEPerolehanAmount = (revenue * ePerolehanPercent) / 100;

                  const sCommissionAmount = (s.tcv - (totalCostWithSST + sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount)) * 0.0685;
                  const sCostWithSSTForLease = s.category === 'one-time' ? (s.totalCost + s.totalSST) : 0;
                  const sTotalFinancingLease = oneTimeCostWithSST > 0
                    ? ((orderToView.option === "No" ? 0 : parseFloat(orderToView.financingLease || "0") * parseInt(orderToView.contractPeriod || "0")) * (sCostWithSSTForLease / oneTimeCostWithSST))
                    : 0;

                  const sTotalOpex = sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount + sCommissionAmount + sTotalFinancingLease;
                  const sEbitda = (s.tcv - (s.totalCost + s.totalSST)) - sTotalOpex;
                  const sTax = sEbitda > 0 ? sEbitda * 0.24 : 0;
                  const sNetMargin = sEbitda - sTax;

                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant={s.category === "one-time" ? "default" : "secondary"} className="text-[10px]">
                          {s.category === "one-time" ? "A" : "B"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-xs truncate max-w-[150px]">{s.name}</TableCell>
                      <TableCell className="text-xs">{s.serviceType}</TableCell>
                      <TableCell className="text-right text-xs">{s.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs">
                        {s.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-primary">{s.tcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-red-600">{s.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-orange-600">{(s.totalCost + s.totalSST).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-green-600">{(s.tcv - (s.totalCost + s.totalSST)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-blue-600">
                        {s.tcv > 0 ? (Math.ceil(((s.tcv - (s.totalCost + s.totalSST)) / s.tcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-amber-600">{sCidbLevyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-indigo-600">{sStampDutyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-purple-600">{sEPerolehanAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-rose-600">{sCommissionAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-emerald-600">{sTotalFinancingLease.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-slate-600">{sTotalOpex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-teal-600">
                        {sEbitda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-cyan-600">
                        {s.tcv > 0 ? ((sEbitda / s.tcv * 100)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-orange-600">
                        {sTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-pink-600">
                        {sNetMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-violet-600">
                        {s.tcv > 0 ? ((sNetMargin / s.tcv * 100)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-[10px]">{s.authorityLevel}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                {(() => {
                  const totals = orderToView.services.filter(s => s.decision === "Installment Plan").reduce((acc, s) => {
                    const isInstallment = s.decision === "Installment Plan";
                    const revenue = isInstallment ? s.totalInstallmentPayment : s.outrightPrice;
                    const totalCostWithSST = s.totalCost + s.totalSST;
                    const cidbLevyPercent = orderToView.cidbLevy === "Yes" ? parseFloat(orderToView.cidbLevyAmount || "0") : 0;
                    const stampDutyPercent = orderToView.stampDuty === "Yes" ? parseFloat(orderToView.stampDutyAmount || "0") : 0;
                    
                    let ePerolehanPercent = 0;
                    if (orderToView.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
                    else if (orderToView.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

                    const sCidbLevyAmount = (revenue * cidbLevyPercent) / 100;
                    const sStampDutyAmount = (revenue * stampDutyPercent) / 100;
                    const sEPerolehanAmount = (revenue * ePerolehanPercent) / 100;

                    const sCommissionAmount = (s.tcv - (totalCostWithSST + sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount)) * 0.0685;

                    const sCostWithSSTForLease = s.category === 'one-time' ? (s.totalCost + s.totalSST) : 0;
                    const sTotalFinancingLease = oneTimeCostWithSST > 0
                      ? ((orderToView.option === "No" ? 0 : parseFloat(orderToView.financingLease || "0") * parseInt(orderToView.contractPeriod || "0")) * (sCostWithSSTForLease / oneTimeCostWithSST))
                      : 0;

                    const sTotalOpex = sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount + sCommissionAmount + sTotalFinancingLease;
                    const grossMargin = s.tcv - (s.totalCost + s.totalSST);
                    const ebitda = grossMargin - sTotalOpex;
                    const tax = ebitda > 0 ? ebitda * 0.24 : 0;
                    const netMargin = ebitda - tax;

                    return {
                      outrightPrice: acc.outrightPrice + s.outrightPrice,
                      monthlyRevenue: acc.monthlyRevenue + s.monthlyRevenue,
                      tcv: acc.tcv + s.tcv,
                      totalCost: acc.totalCost + s.totalCost,
                      totalCostWithSST: acc.totalCostWithSST + totalCostWithSST,
                      grossMargin: acc.grossMargin + grossMargin,
                      cidbLevy: acc.cidbLevy + sCidbLevyAmount,
                      stampDuty: acc.stampDuty + sStampDutyAmount,
                      ePerolehan: acc.ePerolehan + sEPerolehanAmount,
                      commission: acc.commission + sCommissionAmount,
                      totalFinancingLease: acc.totalFinancingLease + sTotalFinancingLease,
                      totalOpex: acc.totalOpex + sTotalOpex,
                      ebitda: acc.ebitda + ebitda,
                      tax: acc.tax + tax,
                      netMargin: acc.netMargin + netMargin,
                    };
                  }, {
                    outrightPrice: 0,
                    monthlyRevenue: 0,
                    tcv: 0,
                    totalCost: 0,
                    totalCostWithSST: 0,
                    grossMargin: 0,
                    cidbLevy: 0,
                    stampDuty: 0,
                    ePerolehan: 0,
                    commission: 0,
                    totalFinancingLease: 0,
                    totalOpex: 0,
                    ebitda: 0,
                    tax: 0,
                    netMargin: 0,
                  });

                  const totalGMPercent = totals.tcv > 0 ? (totals.grossMargin / totals.tcv * 100) : 0;

                  return (
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={3} className="text-right">TOTAL</TableCell>
                      <TableCell className="text-right">{totals.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">{totals.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-primary">{totals.tcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-red-600">{totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-orange-600">{totals.totalCostWithSST.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-green-600">{totals.grossMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-blue-600">{(Math.ceil(totalGMPercent * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</TableCell>
                      <TableCell className="text-right text-amber-600">{totals.cidbLevy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-indigo-600">{totals.stampDuty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-purple-600">{totals.ePerolehan.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-rose-600">{totals.commission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-emerald-600">{totals.totalFinancingLease.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-slate-600">{totals.totalOpex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-teal-600">
                        {totals.ebitda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-cyan-600">
                        {totals.tcv > 0 ? (Math.ceil((totals.ebitda / totals.tcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-orange-600">
                        {totals.tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-pink-600">
                        {totals.netMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-violet-600">
                        {totals.tcv > 0 ? (Math.ceil((totals.netMargin / totals.tcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  );
                })()}
              </TableFooter>
            </Table>
          </CardContent>
        </Card>

        {/* Finance Calculation Data (Overall) */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Finance Calculation Data (Overall)</CardTitle>
              <CardDescription>Consolidated financial calculations for all inventory</CardDescription>
            </div>
            <div className="flex gap-2 print:hidden">
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cat</TableHead>
                  <TableHead>Service Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Outright Purchase Price (RM)</TableHead>
                  <TableHead className="text-right">Monthly Installment Revenue (RM)</TableHead>
                  <TableHead className="text-right font-bold text-primary">Total Revenue (RM)</TableHead>
                  <TableHead className="text-right font-bold text-red-600">Total Cost (RM)</TableHead>
                  <TableHead className="text-right font-bold text-orange-600">Total Cost with SST (RM)</TableHead>
                  <TableHead className="text-right font-bold text-green-600">Gross Margin (RM)</TableHead>
                  <TableHead className="text-right font-bold text-blue-600">Gross Margin (%)</TableHead>
                  <TableHead className="text-right font-bold text-amber-600">CIDB Levy (RM)</TableHead>
                  <TableHead className="text-right font-bold text-indigo-600">Stamp Duty (RM)</TableHead>
                  <TableHead className="text-right font-bold text-purple-600">E-Perolehan (RM)</TableHead>
                  <TableHead className="text-right font-bold text-rose-600">Commission (RM)</TableHead>
                  <TableHead className="text-right font-bold text-emerald-600">Total Financing lease (RM)</TableHead>
                  <TableHead className="text-right font-bold text-slate-600">Total OPEX (RM)</TableHead>
                  <TableHead className="text-right font-bold text-teal-600">EBITDA (RM)</TableHead>
                  <TableHead className="text-right font-bold text-cyan-600">EBITDA Margin (%)</TableHead>
                  <TableHead className="text-right font-bold text-red-400">Tax (RM)</TableHead>
                  <TableHead className="text-right font-bold text-violet-600">Net Margin (RM)</TableHead>
                  <TableHead className="text-right font-bold text-pink-600">Net Margin (%)</TableHead>
                  <TableHead className="text-right">Level of Authority</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orderToView.services.map(s => {
                  const isInstallment = s.decision === "Installment Plan";
                  const revenue = isInstallment ? s.totalInstallmentPayment : s.outrightPrice;
                  const totalCostWithSST = s.totalCost + s.totalSST;
                  const cidbLevyPercent = orderToView.cidbLevy === "Yes" ? parseFloat(orderToView.cidbLevyAmount || "0") : 0;
                  const stampDutyPercent = orderToView.stampDuty === "Yes" ? parseFloat(orderToView.stampDutyAmount || "0") : 0;
                  
                  let ePerolehanPercent = 0;
                  if (orderToView.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
                  else if (orderToView.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

                  const sCidbLevyAmount = (revenue * cidbLevyPercent) / 100;
                  const sStampDutyAmount = (revenue * stampDutyPercent) / 100;
                  const sEPerolehanAmount = (revenue * ePerolehanPercent) / 100;

                  const sCommissionAmount = (s.tcv - (totalCostWithSST + sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount)) * 0.0685;

                  const sCostWithSSTForLease = s.category === 'one-time' ? (s.totalCost + s.totalSST) : 0;
                  const sTotalFinancingLease = oneTimeCostWithSST > 0
                    ? ((orderToView.option === "No" ? 0 : parseFloat(orderToView.financingLease || "0") * parseInt(orderToView.contractPeriod || "0")) * (sCostWithSSTForLease / oneTimeCostWithSST))
                    : 0;

                  const sTotalOpex = sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount + sCommissionAmount + sTotalFinancingLease;
                  const sEbitda = (s.tcv - (s.totalCost + s.totalSST)) - sTotalOpex;
                  const sTax = sEbitda > 0 ? sEbitda * 0.24 : 0;
                  const sNetMargin = sEbitda - sTax;

                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <Badge variant={s.category === "one-time" ? "default" : "secondary"} className="text-[10px]">
                          {s.category === "one-time" ? "A" : "B"}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium text-xs truncate max-w-[150px]">{s.name}</TableCell>
                      <TableCell className="text-xs">{s.serviceType}</TableCell>
                      <TableCell className="text-right text-xs">{s.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs">
                        {s.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-primary">{s.tcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-red-600">{s.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-orange-600">{(s.totalCost + s.totalSST).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-green-600">{(s.tcv - (s.totalCost + s.totalSST)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                       <TableCell className="text-right text-xs font-bold text-blue-600">
                        {s.tcv > 0 ? ((s.tcv - (s.totalCost + s.totalSST)) / s.tcv * 100).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-amber-600">{sCidbLevyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-indigo-600">{sStampDutyAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-purple-600">{sEPerolehanAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-rose-600">{sCommissionAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-emerald-600">{sTotalFinancingLease.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-slate-600">{sTotalOpex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                       <TableCell className="text-right text-xs font-bold text-teal-600">{sEbitda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-xs font-bold text-cyan-600">
                        {s.tcv > 0 ? ((sEbitda / s.tcv * 100)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-red-400">
                        {sTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-violet-600">
                        {sNetMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-xs font-bold text-pink-600">
                        {s.tcv > 0 ? ((sNetMargin / s.tcv * 100)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-[10px]">{s.authorityLevel}</Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
              <TableFooter>
                {(() => {
                  const totals = orderToView.services.reduce((acc, s) => {
                    const isInstallment = s.decision === "Installment Plan";
                    const revenue = isInstallment ? s.totalInstallmentPayment : s.outrightPrice;
                    const totalCostWithSST = s.totalCost + s.totalSST;
                    const cidbLevyPercent = orderToView.cidbLevy === "Yes" ? parseFloat(orderToView.cidbLevyAmount || "0") : 0;
                    const stampDutyPercent = orderToView.stampDuty === "Yes" ? parseFloat(orderToView.stampDutyAmount || "0") : 0;
                    
                    let ePerolehanPercent = 0;
                    if (orderToView.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
                    else if (orderToView.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

                    const sCidbLevyAmount = (revenue * cidbLevyPercent) / 100;
                    const sStampDutyAmount = (revenue * stampDutyPercent) / 100;
                    const sEPerolehanAmount = (revenue * ePerolehanPercent) / 100;

                    const sCommissionAmount = (s.tcv - (totalCostWithSST + sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount)) * 0.0685;

                    const sCostWithSSTForLease = s.category === 'one-time' ? (s.totalCost + s.totalSST) : 0;
                    const sTotalFinancingLease = oneTimeCostWithSST > 0
                      ? ((orderToView.option === "No" ? 0 : parseFloat(orderToView.financingLease || "0") * parseInt(orderToView.contractPeriod || "0")) * (sCostWithSSTForLease / oneTimeCostWithSST))
                      : 0;

                    const sTotalOpex = sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount + sCommissionAmount + sTotalFinancingLease;
                    const grossMargin = s.tcv - (s.totalCost + s.totalSST);
                    const ebitda = grossMargin - sTotalOpex;
                    const tax = ebitda > 0 ? ebitda * 0.24 : 0;
                    const netMargin = ebitda - tax;

                    return {
                      outrightPrice: acc.outrightPrice + s.outrightPrice,
                      monthlyRevenue: acc.monthlyRevenue + s.monthlyRevenue,
                      tcv: acc.tcv + s.tcv,
                      totalCost: acc.totalCost + s.totalCost,
                      totalCostWithSST: acc.totalCostWithSST + totalCostWithSST,
                      grossMargin: acc.grossMargin + grossMargin,
                      cidbLevy: acc.cidbLevy + sCidbLevyAmount,
                      stampDuty: acc.stampDuty + sStampDutyAmount,
                      ePerolehan: acc.ePerolehan + sEPerolehanAmount,
                      commission: acc.commission + sCommissionAmount,
                      totalFinancingLease: acc.totalFinancingLease + sTotalFinancingLease,
                      totalOpex: acc.totalOpex + sTotalOpex,
                      ebitda: acc.ebitda + ebitda,
                      tax: acc.tax + tax,
                      netMargin: acc.netMargin + netMargin,
                    };
                  }, {
                    outrightPrice: 0,
                    monthlyRevenue: 0,
                    tcv: 0,
                    totalCost: 0,
                    totalCostWithSST: 0,
                    grossMargin: 0,
                    cidbLevy: 0,
                    stampDuty: 0,
                    ePerolehan: 0,
                    commission: 0,
                    totalFinancingLease: 0,
                    totalOpex: 0,
                    ebitda: 0,
                    tax: 0,
                    netMargin: 0,
                  });

                  const totalGMPercent = totals.tcv > 0 ? (totals.grossMargin / totals.tcv * 100) : 0;

                  return (
                    <TableRow className="bg-muted/50 font-bold">
                      <TableCell colSpan={3} className="text-right">TOTAL</TableCell>
                      <TableCell className="text-right">{totals.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right">{totals.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-primary">{totals.tcv.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-red-600">{totals.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-orange-600">{totals.totalCostWithSST.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-green-600">{totals.grossMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-blue-600">
                        {(Math.ceil(totalGMPercent * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                      </TableCell>
                      <TableCell className="text-right text-amber-600">{totals.cidbLevy.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-indigo-600">{totals.stampDuty.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-purple-600">{totals.ePerolehan.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-rose-600">{totals.commission.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-emerald-600">{totals.totalFinancingLease.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-slate-600">{totals.totalOpex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-teal-600">{totals.ebitda.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                      <TableCell className="text-right text-cyan-600">
                        {totals.tcv > 0 ? (Math.ceil((totals.ebitda / totals.tcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell className="text-right text-red-400">
                        {totals.tax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-violet-600">
                        {totals.netMargin.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell className="text-right text-pink-600">
                        {totals.tcv > 0 ? (Math.ceil((totals.netMargin / totals.tcv * 100) * 10) / 10).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "0.0"}%
                      </TableCell>
                      <TableCell></TableCell>
                    </TableRow>
                  );
                })()}
              </TableFooter>
            </Table>
          </CardContent>
        </Card>
        </div>
        )}

        {/* Interactive Approvals Engine Section */}
        <div className="print:hidden mt-8">
          {(() => {
            const currentStatus = orderToView.status || "Draft";
            const currentPendingRank = orderToView.currentApprovalRank || "";
            
            let userRankKey = "";
            if (role === "rank4") userRankKey = "Rank 4";
            else if (role === "rank3") userRankKey = "Rank 3";
            else if (role === "rank2") userRankKey = "Rank 2";
            else if (role === "rank1") userRankKey = "Rank 1";
            else if (role === "admin") userRankKey = "ADMIN";

            // Mirrors the fail-closed server check in approveOrder/rejectOrder
            // (FIND-21): a Rank 4 approver needs both their own department and
            // the order's to be present and matching. Previously a missing
            // value on either side rendered the controls for every Rank 4,
            // which would now surface as a permission-denied on click.
            const isAuthorizedApprover = (userRankKey === currentPendingRank || role === "admin") && (
              role !== "rank4" || (
                !!department && !!orderToView.headOfDepartment &&
                department.toLowerCase() === orderToView.headOfDepartment.toLowerCase()
              )
            );
            const isPendingApproval = currentStatus.startsWith("Pending Approval");

            // 1. DRAFT STATE ONLY: only the CREATOR can submit. Rejected orders
            // are terminal — no edit or resubmit path; see the Rejected branch below.
            const isCreator = currentUser?.email?.toLowerCase() === (orderToView.createdBy || "").toLowerCase();
            if (currentStatus === "Draft" && isCreator) {
              return (
                <Card className="shadow-md border-primary/20 bg-gradient-to-br from-background to-muted/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2 text-primary font-semibold">
                      <Send className="h-5 w-5 text-emerald-500 animate-pulse" />
                      {currentStatus === "Rejected" ? "Resubmit for Approval" : "Submit for Approval"}
                    </CardTitle>
                    <CardDescription>
                      {currentStatus === "Rejected" 
                        ? "This order was rejected. Review the comments in the audit log, make adjustments in Edit mode, and resubmit it to initiate the approval sequence."
                        : "Ready to proceed? Submit this FA request to the designated authority. The sequence starts with Rank 4 Sales Head."}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-sm text-muted-foreground flex items-center gap-2">
                      <span>Current Status:</span>
                      <Badge className={
                        currentStatus === "Rejected"
                          ? "bg-rose-100 text-rose-800 border-rose-200 hover:bg-rose-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-rose-200"
                          : "bg-slate-100 text-slate-800 border-slate-200 hover:bg-slate-100 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-slate-200"
                      }>
                        {currentStatus}
                      </Badge>
                    </div>

                    <Dialog open={isSubmitDialogOpen} onOpenChange={setIsSubmitDialogOpen}>
                      <DialogTrigger
                        render={
                          <Button
                            className="gap-2 bg-yellow-400 hover:bg-yellow-500 text-black border-none font-semibold shadow-sm w-full sm:w-auto cursor-pointer"
                          />
                        }
                      >
                        <Send className="h-4 w-4" />
                        {currentStatus === "Rejected" ? "Resubmit Order" : "Submit for Approval"}
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Submit Order for Approval</DialogTitle>
                          <DialogDescription>
                            Confirm submitting order {orderToView.orderNumber} for review and approval.
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-4">
                          <div className="space-y-2">
                            <Label htmlFor="approver">Approval Sequence Start</Label>
                            <Input
                              id="approver"
                              value={`Rank 4: ${orderToView.headOfDepartment || "Head of Sales"}`}
                              disabled
                              className="bg-muted text-foreground"
                            />
                            <p className="text-xs text-muted-foreground">
                              Order will flow through: Rank 4 ➔ {orderToView.finalDecisionAuthorityRank || "Final Decision Maker"} based on pricing & margin governance.
                            </p>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="submission-note">Submission Note (Optional)</Label>
                            <Textarea
                              id="submission-note"
                              placeholder="Provide details or business context for the approvers..."
                              value={submissionNote}
                              onChange={(e) => setSubmissionNote(e.target.value)}
                              rows={3}
                            />
                          </div>
                        </div>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsSubmitDialogOpen(false)}>
                            Cancel
                          </Button>
                          <Button onClick={handleSubmitApproval} disabled={isSubmitting} className="bg-primary text-primary-foreground hover:bg-primary/90">
                            {isSubmitting ? "Submitting..." : "Confirm Submission"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </CardContent>
                </Card>
              );
            }

            // 2. ACTIVE PENDING STATE & LOGGED-IN USER IS THE AUTHORIZED APPROVER
            if (isPendingApproval && isAuthorizedApprover) {
              let pendingRoleName = orderToView.headOfDepartment || "Head of Sales";
              if (currentPendingRank === "Rank 3") pendingRoleName = "Head of Commercial";
              else if (currentPendingRank === "Rank 2") pendingRoleName = "CEBO";
              else if (currentPendingRank === "Rank 1") pendingRoleName = "CFO";

              return (
                <Card className="shadow-lg border-2 border-primary bg-primary/5">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center gap-2 text-primary font-bold">
                      <ShieldCheck className="h-5 w-5 text-primary" />
                      Pending Approval Decision: {pendingRoleName} ({currentPendingRank})
                    </CardTitle>
                    <CardDescription className="text-foreground/80 font-medium">
                      {userRankKey === "ADMIN" 
                        ? `🛡️ Admin Override Mode: You have full privilege to decide on behalf of ${pendingRoleName} (${currentPendingRank}).`
                        : `You are authorized to approve or reject this costing order at this step.`}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 pt-2">
                    <div className="space-y-2">
                      <Label htmlFor="approval-comment" className="font-semibold text-sm">
                        Decision Notes / Feedback Comment (Required)
                      </Label>
                      <Textarea
                        id="approval-comment"
                        placeholder="Add some notes, reasoning, or justification for your decision..."
                        value={approvalComment}
                        onChange={(e) => setApprovalComment(e.target.value)}
                        rows={3}
                        className="bg-background"
                      />
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3 justify-end pt-2">
                      <Button
                        variant="destructive"
                        onClick={handleRejectAction}
                        disabled={isApproving || !approvalComment.trim()}
                        className="gap-2 cursor-pointer font-semibold min-w-32"
                      >
                        <ThumbsDown className="h-4 w-4" />
                        Reject
                      </Button>
                      <Button
                        onClick={handleApproveAction}
                        disabled={isApproving || !approvalComment.trim()}
                        className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer font-bold min-w-32 animate-pulse"
                      >
                        <ThumbsUp className="h-4 w-4" />
                        Approve
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            }

            // 3. PENDING STATE BUT LOGGED-IN USER IS NOT THE AUTHORIZED APPROVER
            if (isPendingApproval) {
                            let pendingRoleName = orderToView.headOfDepartment || "Head of Sales";
              if (currentPendingRank === "Rank 3") pendingRoleName = "Head of Commercial";
              else if (currentPendingRank === "Rank 2") pendingRoleName = "CEBO";
              else if (currentPendingRank === "Rank 1") pendingRoleName = "CFO";

              return (
                <Card className="shadow-md border-amber-500/20 bg-amber-50/10">
                  <CardHeader className="py-4">
                    <CardTitle className="text-base flex items-center gap-2 text-amber-600 font-semibold">
                      <Clock className="h-5 w-5 animate-spin text-amber-500" />
                      Currently Under Review
                    </CardTitle>
                    <CardDescription className="text-sm text-foreground/80">
                      This order is awaiting review from <strong className="text-foreground font-bold">{pendingRoleName} ({currentPendingRank})</strong>. 
                    </CardDescription>
                  </CardHeader>
                  {isCreator && (
                    <CardContent className="pt-0">
                      <p className="text-xs text-muted-foreground mb-3">
                        Need to make changes? Withdrawing pulls this request out of the approval queue so you can edit it. You'll need to resubmit afterward, and the review starts again from Rank 4.
                      </p>
                      <Dialog open={isWithdrawDialogOpen} onOpenChange={setIsWithdrawDialogOpen}>
                        <DialogTrigger
                          render={
                            <Button variant="outline" size="sm" className="gap-2 border-amber-400 text-amber-700 hover:bg-amber-100 cursor-pointer" />
                          }
                        >
                          <Edit className="h-3.5 w-3.5" />
                          Withdraw & Edit
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>Withdraw from Review?</DialogTitle>
                            <DialogDescription>
                              This will pull order {orderToView.orderNumber} out of the approval queue at {pendingRoleName} ({currentPendingRank}) and set it back to Draft so you can edit it.
                              Any approvals already given at earlier ranks will remain on record. You'll need to resubmit for approval afterward, starting again from Rank 4.
                            </DialogDescription>
                          </DialogHeader>
                          <DialogFooter>
                            <Button variant="outline" onClick={() => setIsWithdrawDialogOpen(false)}>
                              Cancel
                            </Button>
                            <Button
                              onClick={handleWithdrawFromReview}
                              disabled={isWithdrawing}
                              className="bg-amber-600 hover:bg-amber-700 text-white"
                            >
                              {isWithdrawing ? "Withdrawing..." : "Withdraw & Edit"}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </CardContent>
                  )}
                </Card>
              );
            }

            // 4. REJECTED STATE — terminal. No edit or resubmit; direct them to start fresh.
            if (currentStatus === "Rejected") {
              return (
                <Card className="shadow-md border-rose-500/20 bg-rose-50/10">
                  <CardHeader className="py-4">
                    <CardTitle className="text-base flex items-center gap-2 text-rose-600 font-semibold">
                      <ThumbsDown className="h-5 w-5 text-rose-500" />
                      Request Rejected
                    </CardTitle>
                    <CardDescription className="text-sm text-foreground/80">
                      This request was rejected and is now closed — review the comments in the audit log above for context.
                      {isCreator ? " To proceed, please submit a new FA request." : ""}
                    </CardDescription>
                  </CardHeader>
                  {isCreator && (
                    <CardContent className="pt-0">
                      <Button asChild variant="outline" size="sm">
                        <Link to="/manage">
                          <Plus className="mr-2 h-4 w-4" />
                          Start a New FA Request
                        </Link>
                      </Button>
                    </CardContent>
                  )}
                </Card>
              );
            }

            // 5. APPROVED STATE
            if (currentStatus === "Approved") {
              return (
                <Card className="shadow-md border-emerald-500/20 bg-emerald-50/10">
                  <CardHeader className="py-4">
                    <CardTitle className="text-base flex items-center gap-2 text-emerald-600 font-semibold">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      Costing Order Approved!
                    </CardTitle>
                    <CardDescription className="text-sm">
                      This service costing order has been fully approved by all required levels of governance and is locked for processing.
                    </CardDescription>
                  </CardHeader>
                </Card>
              );
            }

            return null;
          })()}
        </div>
      </div>
      </div>
    </div>
  );
}