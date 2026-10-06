import { useState, useMemo, Dispatch, SetStateAction, useEffect } from "react";
import { Service, Order, ServiceCategory, OrderMetadata, CONTRACT_TYPES } from "../types";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Printer, FileDown, CheckCircle2, Hash, Edit, Trash2, Save, Plus, Info, User, TrendingUp, Wallet, FileText, FileSpreadsheet, Paperclip } from "lucide-react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { toast } from "sonner";
import { ServiceForm } from "../components/ServiceForm";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import Header from "../components/Header";
import { openAttachment } from "../lib/attachments";
import { useAuth } from "../context/AuthContext";
import { DatePicker } from "@/components/DatePicker";

interface SummaryReportProps {
  services: Service[];
  setServices: Dispatch<SetStateAction<Service[]>>;
  onConfirm?: (order: Order, reset?: boolean) => void;
  orders?: Order[];
  setOrders: Dispatch<SetStateAction<Order[]>>;
  metadata: OrderMetadata;
  setMetadata: Dispatch<SetStateAction<OrderMetadata>>;
}

export default function SummaryReport({ services: currentServices, setServices, onConfirm, orders = [], setOrders, metadata, setMetadata }: SummaryReportProps) {
  const { role } = useAuth();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const orderId = searchParams.get("id");
  
  // If we have an ID, we're viewing an existing order. Otherwise, we're viewing the current draft.
  const existingOrder = useMemo(() => orders.find(o => o.id === orderId), [orders, orderId]);
  
  const [localServices, setLocalServices] = useState<Service[]>([]);
  const oneTimeCostWithSST = localServices.reduce((acc, s) => {
    if (s.category === 'one-time') {
      return acc + s.totalCost + s.totalSST;
    }
    return acc;
  }, 0);
  const [orderNumber, setOrderNumber] = useState<string | null>(null);

  const [isEditingMetadata, setIsEditingMetadata] = useState(false);

  useEffect(() => {
    if (existingOrder) {
      setLocalServices(existingOrder.services);
      setOrderNumber(existingOrder.orderNumber);
      // Update metadata from existing order
      setMetadata({
        servicesProducts: existingOrder.servicesProducts || "",
        companyName: existingOrder.companyName || "",
        projectBrief: existingOrder.projectBrief || "",
        justification: existingOrder.justification || "",
        accountManager: existingOrder.accountManager || "",
        regionalManager: existingOrder.regionalManager || "",
        headOfDepartment: existingOrder.headOfDepartment || "",
        pricer: existingOrder.pricer || "",
        solutionArchitect: existingOrder.solutionArchitect || "",
        salesforceId: existingOrder.salesforceId || "",
        vendorName: existingOrder.vendorName || "",
        businessDevelop: existingOrder.businessDevelop || "",
        preSales: existingOrder.preSales || "",
        cidbLevy: existingOrder.cidbLevy || "No",
        cidbLevyAmount: existingOrder.cidbLevyAmount || "0",
        stampDuty: existingOrder.stampDuty || "No",
        stampDutyAmount: existingOrder.stampDutyAmount || "0",
        ePerolehan: existingOrder.ePerolehan || "No",
        solutionServiceType: existingOrder.solutionServiceType || "",
        date: existingOrder.date || new Date().toISOString().split('T')[0],
        contractType: existingOrder.contractType || "New Contract",
        exchangeRate: existingOrder.exchangeRate || "1.00",
        option: existingOrder.option || "No",
        totalOneTimeChargeB2S: existingOrder.totalOneTimeChargeB2S || "0",
        totalUpfrontPayment: existingOrder.totalUpfrontPayment || "0",
        totalFinancingRequest: existingOrder.totalFinancingRequest || "0",
        financingLease: existingOrder.financingLease || "0",
        contractPeriod: existingOrder.contractPeriod || "",
        finalDecisionMaker: existingOrder.finalDecisionMaker || "",
        finalDecisionAuthorityRank: existingOrder.finalDecisionAuthorityRank || "",
        currency: existingOrder.currency || "Malaysian Ringgit"
      });
    } else {
      setLocalServices(currentServices);
      setOrderNumber(null);
    }
  }, [existingOrder, currentServices, setMetadata]);

  useEffect(() => {
    // Upfront Payment logic: find services with Upfront Payment to set totalUpfrontPayment in metadata
    const upfront = Math.round(localServices.reduce((acc, s) => {
      if (s.decision === "Upfront Payment") {
        return acc + s.outrightPrice;
      }
      return acc;
    }, 0));
    
    // Auto-calculate B2S based on One-Time cost services if Option is Yes
    const oneTimeCostWithSST = localServices.reduce((acc, s) => {
      if (s.category === 'one-time') {
        return acc + s.totalCost + s.totalSST;
      }
      return acc;
    }, 0);
    
    // Auto-set Option to Yes if oneTimeCostWithSST > upfront, otherwise No
    const autoOption = oneTimeCostWithSST > upfront ? "Yes" : "No";
    const b2s = Math.round(autoOption === "Yes" ? oneTimeCostWithSST : 0);
    const request = Math.round(Math.max(0, b2s - upfront));

    // Final Decision Maker logic
    let lowestRankNum = 4; // Start at the most junior rank
    let autoDecisionMaker = "Head of Sales";

    // Update according to services
    localServices.forEach(s => {
      if (s.authorityRank) {
        const rankMatch = s.authorityRank.match(/Rank (\d+)/);
        if (rankMatch) {
          const num = parseInt(rankMatch[1]);
          if (num < lowestRankNum) {
            lowestRankNum = num;
            autoDecisionMaker = s.authorityLevel === "Head ES & BP" ? "Head of Commercial" : (s.authorityLevel === "Approved" ? "Head of Sales" : (s.authorityLevel || "Head of Sales"));
          }
        }
      } else if (s.authorityLevel) {
        // Fallback for services with Level but no Rank
        let num = 4;
        if (s.authorityLevel === "Finance") num = 1;
        else if (s.authorityLevel === "CEBO") num = 2;
        else if (s.authorityLevel === "Head of Commercial" || s.authorityLevel === "Head of Enterprise Sales Planning" || s.authorityLevel === "Head ES & BP") num = 3;
        else if (s.authorityLevel === "Head of Sales" || s.authorityLevel === "Approved") num = 4;
        
        if (num < lowestRankNum) {
          lowestRankNum = num;
          autoDecisionMaker = s.authorityLevel === "Head ES & BP" ? "Head of Commercial" : (s.authorityLevel === "Approved" ? "Head of Sales" : s.authorityLevel);
        }
      }
    });

    const autoAuthorityRank = `Rank ${lowestRankNum}`;

    // Auto-calculate Contract Period: Highest installment period among all services
    const maxContractTenure = localServices.length > 0 
      ? Math.max(...localServices.map(s => s.installmentPeriod || 0))
      : 0;

    const n = (autoOption === "Yes" && maxContractTenure > 0) ? maxContractTenure : parseInt(metadata.contractPeriod || "0");
    let autoFinancingLease = 0;
    if (autoOption === "Yes" && request > 0 && n > 0) {
      const r = 0.05 / 12;
      const pmt = (request * r) / (1 - Math.pow(1 + r, -n));
      const monthlyPrincipal = request / n;
      // Formula: (PMT(5%/12, Contract Period, Total Financing Request) - (Total Financing Request / Contract Period))
      autoFinancingLease = pmt - monthlyPrincipal;
    }

    const needsUpdate = 
      metadata.totalOneTimeChargeB2S !== b2s.toString() ||
      metadata.totalUpfrontPayment !== upfront.toString() || 
      metadata.totalFinancingRequest !== request.toString() ||
      metadata.finalDecisionMaker !== autoDecisionMaker ||
      metadata.finalDecisionAuthorityRank !== autoAuthorityRank ||
      metadata.option !== autoOption ||
      metadata.financingLease !== Math.round(autoFinancingLease).toString() ||
      (autoOption === "Yes" && metadata.contractPeriod !== maxContractTenure.toString() && maxContractTenure > 0);

    if (needsUpdate) {
      setMetadata(prev => ({
        ...prev,
        totalOneTimeChargeB2S: b2s.toString(),
        totalUpfrontPayment: upfront.toString(),
        totalFinancingRequest: request.toString(),
        finalDecisionMaker: autoDecisionMaker,
        finalDecisionAuthorityRank: autoAuthorityRank,
        option: autoOption,
        financingLease: autoFinancingLease > 0 ? Math.round(autoFinancingLease).toString() : "0",
        contractPeriod: (autoOption === "Yes" && maxContractTenure > 0) ? maxContractTenure.toString() : prev.contractPeriod
      }));
    }
  }, [localServices, metadata.totalOneTimeChargeB2S, setMetadata, metadata.totalUpfrontPayment, metadata.totalFinancingRequest, metadata.finalDecisionMaker, metadata.finalDecisionAuthorityRank, metadata.financingLease, metadata.option, metadata.contractPeriod]);
  
  const [isConfirmed, setIsConfirmed] = useState(!!existingOrder);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [addingCategory, setAddingCategory] = useState<ServiceCategory>("one-time");
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);

  const partA = localServices.filter(s => s.category === "one-time");
  const partB = localServices.filter(s => s.category === "annual");

  const pricingSummary = useMemo(() => {
    const totalUpfront = localServices.reduce((acc, s) => acc + s.outrightPrice, 0);
    const totalInstallment = localServices.reduce((acc, s) => acc + s.monthlyRevenue, 0);
    const totalTCV = localServices.reduce((acc, s) => {
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
  }, [localServices]);

  const costingSummary = useMemo(() => {
    return localServices.reduce((acc, s) => {
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
  }, [localServices]);

  const pricerMarginSummary = useMemo(() => {
    const totals = localServices.reduce((acc, s) => {
      const isInstallment = s.decision === "Installment Plan";
      const revenue = isInstallment ? s.totalInstallmentPayment : s.outrightPrice;
      const totalCostWithSST = s.totalCost + s.totalSST;
      const cidbLevyPercent = metadata.cidbLevy === "Yes" ? parseFloat(metadata.cidbLevyAmount || "0") : 0;
      const stampDutyPercent = metadata.stampDuty === "Yes" ? parseFloat(metadata.stampDutyAmount || "0") : 0;
      
      let ePerolehanPercent = 0;
      if (metadata.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
      else if (metadata.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

      const sCidbLevyAmount = (revenue * cidbLevyPercent) / 100;
      const sStampDutyAmount = Math.ceil((revenue * stampDutyPercent) / 100);
      const sEPerolehanAmount = Math.floor((revenue * ePerolehanPercent) * 10 / 100) / 10;

      const sCommissionAmount = (s.tcv - (totalCostWithSST + sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount)) * 0.0685;
      const sCostWithSSTForLease = s.category === 'one-time' ? (s.totalCost + s.totalSST) : 0;
      const sTotalFinancingLease = oneTimeCostWithSST > 0
        ? ((metadata.option === "No" ? 0 : parseFloat(metadata.financingLease || "0") * parseInt(metadata.contractPeriod || "0")) * (sCostWithSSTForLease / oneTimeCostWithSST))
        : 0;

      const sTotalOpex = sCidbLevyAmount + sStampDutyAmount + sEPerolehanAmount + sCommissionAmount + sTotalFinancingLease;
      const grossMargin = s.tcv - (s.totalCost + s.totalSST);
      const ebitda = grossMargin - sTotalOpex;
      const tax = ebitda > 0 ? ebitda * 0.24 : 0;
      const netMargin = ebitda - tax;

      return {
        tcv: acc.tcv + s.tcv,
        grossMargin: acc.grossMargin + grossMargin,
        ebitda: acc.ebitda + ebitda,
        netMargin: acc.netMargin + netMargin,
      };
    }, {
      tcv: 0,
      grossMargin: 0,
      ebitda: 0,
      netMargin: 0,
    });

    const grossMarginPercentage = totals.tcv > 0 ? (totals.grossMargin / totals.tcv) * 100 : 0;
    const ebitdaMarginPercentage = totals.tcv > 0 ? (totals.ebitda / totals.tcv) * 100 : 0;
    const netMarginPercentage = totals.tcv > 0 ? (totals.netMargin / totals.tcv) * 100 : 0;

    return {
      grossMarginPercentage,
      ebitdaMarginPercentage,
      netMarginPercentage
    };
  }, [localServices, metadata]);

  // Head of Department drives the Rank 4 approval routing. The field has always
  // been marked required in the Dashboard form but was never enforced, which is
  // how orders with an empty value were able to reach the approval chain. Gate
  // Confirm on it here so the requester gets a form-level message rather than a
  // server error at the last step.
  const headOfDepartmentMissing = !metadata.headOfDepartment;

  const handleConfirm = async () => {
    if (isConfirmed && !existingOrder) return; // Already confirmed draft

    if (headOfDepartmentMissing) {
      // Open the metadata editor first — the Select lives behind that toggle,
      // so a bare toast would point at a field the user cannot see.
      setIsEditingMetadata(true);
      toast.error("Select a Head of Department before confirming.", {
        description: "It determines which Rank 4 approver receives this request.",
      });
      return;
    }

    // Close any open editing states
    setIsEditingMetadata(false);

    let newOrderNumber = orderNumber;
    
    if (!newOrderNumber) {
      const faPattern = /^FA-(\d+)$/;
      const existingNumbers = orders
        .map(o => {
          const match = o.orderNumber.match(faPattern);
          return match ? parseInt(match[1], 10) : 0;
        })
        .filter(n => !isNaN(n));
      
      const nextNum = existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 1;
      newOrderNumber = `FA-${nextNum.toString().padStart(4, '0')}`;
    }
    
    const newOrder: Order = {
      ...metadata,
      id: crypto.randomUUID(), // Always new ID to keep history
      orderNumber: newOrderNumber,
      version: existingOrder ? (existingOrder.version || 1) + 1 : 1,
      services: [...localServices],
      totalRevenue: pricingSummary.totalTCV,
      totalCost: costingSummary.tcv.total,
      createdAt: Date.now(),
      // Confirm saves as Draft. The creator then clicks "Submit for Approval"
      // (in OrderDetails) to enter the chain. Edited/re-confirmed orders —
      // including rejected ones — also return to Draft for review before resubmitting.
      status: "Draft",
      currentApprovalRank: "",
      approvalHistory: [],
    };

        // Only mark confirmed and toast success AFTER the server save actually succeeds.
    try {
      if (onConfirm) {
        await onConfirm(newOrder, !existingOrder);
      }
    } catch (e) {
      // handleConfirmOrder already showed an error toast; don't show success.
      return;
    }

    setOrderNumber(newOrderNumber);
    setIsConfirmed(true);

    if (existingOrder) {
      toast.success("FA Request successfully updated", {
        description: `New version v${newOrder.version} has been created.`,
      });
    } else {
      toast.success("FA Request confirmed successfully!", {
        description: "Your FA Request has been saved as a draft.",
      });
    }
    setTimeout(() => {
      navigate("/");
    }, 1500);
  };

  const handleMetadataChange = (field: keyof OrderMetadata, value: string) => {
    setMetadata(prev => {
      const newMetadata = { ...prev, [field]: value };
      if (field === "cidbLevy" && value === "Yes") {
        newMetadata.cidbLevyAmount = "0.125";
      }
      if (field === "stampDuty" && value === "Yes") {
        newMetadata.stampDutyAmount = "0.5";
      }
      return newMetadata;
    });
  };

  const handleEdit = (service: Service) => {
    setAddingCategory(service.category);
    setEditingService(service);
    setIsFormOpen(true);
  };

  const openAddForm = (category: ServiceCategory) => {
    setAddingCategory(category);
    setEditingService(null);
    setIsFormOpen(true);
  };

  const handleDelete = (id: string) => {
    setServiceToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const handleAddService = (data: any) => {
    const updatedService: Service = {
      ...data,
      category: editingService ? editingService.category : addingCategory,
      id: editingService?.id || crypto.randomUUID(),
      updatedAt: Date.now(),
    };

    setLocalServices(prev => {
      const exists = prev.find(s => s.id === editingService?.id);
      if (exists) {
        return prev.map(s => s.id === editingService?.id ? updatedService : s);
      }
      return [...prev, updatedService];
    });
    
    toast.success("Service updated");
    setIsFormOpen(false);
    setEditingService(null);
  };

  const confirmDelete = () => {
    if (serviceToDelete) {
      setLocalServices(prev => prev.filter(s => s.id !== serviceToDelete));
      toast.success("Service removed");
      setIsDeleteConfirmOpen(false);
      setServiceToDelete(null);
    }
  };

  return (
    <div className="min-h-screen bg-muted/30 font-sans">
      <Header />
      <div className="p-4 md:p-8">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 print:hidden">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">
                {existingOrder ? "FA Request Details" : "Combined Summary Report"}
              </h1>
              <div className="flex items-center gap-2">
                <p className="text-muted-foreground">
                  {existingOrder ? `Viewing confirmed FA request` : "Detailed breakdown of Part A & Part B services"}
                </p>
                {orderNumber && (
                  <div className="flex items-center gap-1">
                    <Badge variant="outline" className="bg-primary/5 text-primary border-primary/20 font-mono font-bold">
                      <Hash className="h-3 w-3 mr-1" />
                      {orderNumber}
                    </Badge>
                    {existingOrder && (
                      <Badge className="text-[10px] h-5 px-2 bg-yellow-100 text-yellow-800 border-yellow-300 font-bold">
                        v{existingOrder.version || 1}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            {role === "user" && (
              <Button 
                onClick={handleConfirm}
                disabled={(isConfirmed && !existingOrder) || headOfDepartmentMissing}
                title={headOfDepartmentMissing ? "Select a Head of Department first" : undefined}
                className={`${isConfirmed && !existingOrder ? 'bg-green-500' : 'bg-green-600 hover:bg-green-700'} text-white border-none`}
              >
                {isConfirmed && !existingOrder ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> 
                    Confirmed
                  </>
                ) : existingOrder ? (
                  <>
                    <Save className="mr-2 h-4 w-4" /> 
                    Update Report
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" /> 
                    Save As Draft
                  </>
                )}
              </Button>
            )}
          </div>
        </div>

        {/* Project Header Info */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Project Information */}
          <Card className="relative group">
            <CardHeader className="pb-2 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <Info className="h-4 w-4 text-primary" />
                Project Information
              </CardTitle>
              {role === "user" && (
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="h-8 w-8 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                  onClick={() => setIsEditingMetadata(!isEditingMetadata)}
                >
                  <Edit className="h-4 w-4" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {isEditingMetadata ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Services/Products</Label>
                    <Input 
                      value={metadata.servicesProducts || ""} 
                      onChange={(e) => handleMetadataChange("servicesProducts", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Company Name</Label>
                    <Input 
                      value={metadata.companyName || ""} 
                      onChange={(e) => handleMetadataChange("companyName", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Account Manager</Label>
                    <Input 
                      value={metadata.accountManager || ""} 
                      onChange={(e) => handleMetadataChange("accountManager", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Regional Manager</Label>
                    <Input 
                      value={metadata.regionalManager || ""} 
                      onChange={(e) => handleMetadataChange("regionalManager", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">
                      Head of Department <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={metadata.headOfDepartment || ""}
                      onValueChange={(v) => handleMetadataChange("headOfDepartment", v)}
                    >
                      <SelectTrigger className="h-auto min-h-8 py-1.5 text-sm w-full whitespace-normal break-words [&&_[data-slot=select-value]]:line-clamp-none [&&_[data-slot=select-value]]:whitespace-normal">
                        <SelectValue placeholder="Select Head of Department" />
                      </SelectTrigger>
                      <SelectContent className="w-[calc(100vw-2rem)] sm:w-[450px] md:w-[500px] max-w-xl">
                        <SelectItem value="Head of Enterprise Sales, Region">
                          Head of Enterprise Sales, Region
                        </SelectItem>
                        <SelectItem value="Head of Enterprise Sales, Public Sector, GLCs & Named Accounts">
                          Head of Enterprise Sales, Public Sector, GLCs & Named Accounts
                        </SelectItem>
                        <SelectItem value="Head of Enterprise Sales (Strategic & Corporate Accounts)">
                          Head of Enterprise Sales (Strategic & Corporate Accounts)
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Pricer</Label>
                    <Input 
                      value={metadata.pricer || ""} 
                      onChange={(e) => handleMetadataChange("pricer", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Solution Architect</Label>
                    <Input 
                      value={metadata.solutionArchitect || ""} 
                      onChange={(e) => handleMetadataChange("solutionArchitect", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">S/ Force/ FA ID</Label>
                    <Input 
                      value={metadata.salesforceId || ""} 
                      onChange={(e) => handleMetadataChange("salesforceId", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Vendor Name</Label>
                    <Input 
                      value={metadata.vendorName || ""} 
                      onChange={(e) => handleMetadataChange("vendorName", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Business Develop</Label>
                    <Input 
                      value={metadata.businessDevelop || ""} 
                      onChange={(e) => handleMetadataChange("businessDevelop", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Pre-Sales</Label>
                    <Input 
                      value={metadata.preSales || ""} 
                      onChange={(e) => handleMetadataChange("preSales", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">CIDB Levy</Label>
                    <Select value={metadata.cidbLevy || "No"} onValueChange={(v) => handleMetadataChange("cidbLevy", v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Stamp Duty</Label>
                    <Select value={metadata.stampDuty || "No"} onValueChange={(v) => handleMetadataChange("stampDuty", v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Yes">Yes</SelectItem>
                        <SelectItem value="No">No</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">E-Perolehan</Label>
                    <Select value={metadata.ePerolehan || "No"} onValueChange={(v) => handleMetadataChange("ePerolehan", v)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="No">No</SelectItem>
                        <SelectItem value="0.8%">0.8%</SelectItem>
                        <SelectItem value="0.4%">0.4%</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Solution Service Type</Label>
                    <Select
                      value={metadata.solutionServiceType || ""}
                      onValueChange={(v) => handleMetadataChange("solutionServiceType", v)}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue placeholder="Select service type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Reselling service only">
                          Reselling service only
                        </SelectItem>
                        <SelectItem value="Total solution">
                          Total solution
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Date</Label>
                    <DatePicker
                      value={metadata.date || ""}
                      onChange={(v) => handleMetadataChange("date", v)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Contract Type</Label>
                    <Select 
                      value={metadata.contractType || "New Contract"} 
                      onValueChange={(v) => handleMetadataChange("contractType", v)}
                    >
                      <SelectTrigger className="h-8 text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTRACT_TYPES.map(t => (
                          <SelectItem key={t} value={t}>{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Exchange rate</Label>
                    <Input 
                      value={metadata.exchangeRate || "1.00"} 
                      onChange={(e) => handleMetadataChange("exchangeRate", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Project Brief</Label>
                    <Textarea 
                      value={metadata.projectBrief || ""} 
                      onChange={(e) => handleMetadataChange("projectBrief", e.target.value)}
                      className="text-sm min-h-[60px]"
                    />
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Justification</Label>
                    <Textarea 
                      value={metadata.justification || ""} 
                      onChange={(e) => handleMetadataChange("justification", e.target.value)}
                      className="text-sm min-h-[60px]"
                    />
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Services/Products</Label>
                    <p className="text-sm font-medium">{metadata.servicesProducts || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Company Name</Label>
                    <p className="text-sm font-medium">{metadata.companyName || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Account Manager</Label>
                    <p className="text-sm font-medium">{metadata.accountManager || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Regional Manager</Label>
                    <p className="text-sm font-medium">{metadata.regionalManager || "-"}</p>
                  </div>
                  <div className="space-y-1 col-span-2 sm:col-span-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Head of Department</Label>
                    <p className="text-sm font-medium">{metadata.headOfDepartment || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Pricer</Label>
                    <p className="text-sm font-medium">{metadata.pricer || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Solution Architect</Label>
                    <p className="text-sm font-medium">{metadata.solutionArchitect || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">S/ Force/ FA ID</Label>
                    <p className="text-sm font-medium">{metadata.salesforceId || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Vendor Name</Label>
                    <p className="text-sm font-medium">{metadata.vendorName || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Business Develop</Label>
                    <p className="text-sm font-medium">{metadata.businessDevelop || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Pre-Sales</Label>
                    <p className="text-sm font-medium">{metadata.preSales || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Levies & Duties</Label>
                    <div className="flex flex-wrap gap-2">
                       {metadata.cidbLevy === "Yes" && <Badge variant="outline">CIDB</Badge>}
                       {metadata.stampDuty === "Yes" && <Badge variant="outline">Stamp Duty</Badge>}
                       {metadata.ePerolehan !== "No" && <Badge variant="outline">EP ({metadata.ePerolehan})</Badge>}
                       {metadata.cidbLevy !== "Yes" && metadata.stampDuty !== "Yes" && metadata.ePerolehan === "No" && "-"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Contract Type</Label>
                    <p className="text-sm font-medium">{metadata.contractType || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Solution Service Type</Label>
                    <p className="text-sm font-medium">{metadata.solutionServiceType || "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Date</Label>
                    <p className="text-sm font-medium">{metadata.date ? formatDate(metadata.date) : "-"}</p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase text-muted-foreground">Exchange Rate</Label>
                    <p className="text-sm font-medium">{metadata.exchangeRate || "1.00"}</p>
                  </div>

                  <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Project Brief</Label>
                    <div className="text-sm border p-2 rounded bg-muted/20 min-h-[40px] whitespace-pre-wrap">{metadata.projectBrief || "-"}</div>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground">Justification</Label>
                    <div className="text-sm border p-2 rounded bg-muted/20 min-h-[40px] whitespace-pre-wrap">{metadata.justification || "-"}</div>
                  </div>
                  <div className="space-y-1 col-span-2">
                    <Label className="text-[10px] uppercase text-muted-foreground flex items-center gap-1">
                      <Paperclip className="h-3 w-3" />
                      Attachments
                    </Label>
                    {metadata.attachments && metadata.attachments.length > 0 ? (
                      <div className="space-y-1.5">
                        {metadata.attachments.map((attachment) => (
                          <button
                            key={attachment.id}
                            type="button"
                            onClick={() =>
                              openAttachment({ mode: "draft", path: attachment.path }).catch((e) =>
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
                      <div className="text-sm border p-2 rounded bg-muted/20 min-h-[40px] flex items-center text-muted-foreground">-</div>
                    )}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Pricing Summary Side-by-Side */}
          <div className="space-y-6">
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
                  <div className="text-lg font-bold text-primary">RM {pricingSummary.totalTCV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                <Separator />
                <div className="grid grid-cols-2 gap-3">
                   <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Upfront Price</div>
                      <div className="font-semibold">RM {pricingSummary.totalUpfront.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                   </div>
                   <div>
                      <div className="text-[10px] uppercase text-muted-foreground">Monthly Rev</div>
                      <div className="font-semibold">RM {pricingSummary.totalInstallment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                   </div>
                </div>
              </CardContent>
            </Card>

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
                  <div className="text-lg font-bold">RM {costingSummary.tcv.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">Overall Total Cost (without SST)</div>
                      <div className="text-xs font-semibold">RM {costingSummary.tcv.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">Overall SST</div>
                      <div className="text-xs font-semibold">RM {costingSummary.tcv.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="text-[10px] uppercase text-muted-foreground">Total(RM)-One Time Cost Services</div>
                  <div className="text-lg font-bold">RM {costingSummary.upfront.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">Total Cost</div>
                      <div className="text-xs font-semibold">RM {costingSummary.upfront.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">Total SST</div>
                      <div className="text-xs font-semibold">RM {costingSummary.upfront.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-muted/50 border">
                  <div className="text-[10px] uppercase text-muted-foreground">Total(RM)-Annual Services Cost</div>
                  <div className="text-lg font-bold">RM {costingSummary.installment.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                  <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-border/50">
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">Total Cost</div>
                      <div className="text-xs font-semibold">RM {costingSummary.installment.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                    <div>
                      <div className="text-[9px] uppercase text-muted-foreground">Total SST</div>
                      <div className="text-xs font-semibold">RM {costingSummary.installment.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
            
          </div>
        </div>

        {/* Original box-style Summary of Pricing/Costing — preserved but hidden. Flip {false && back to true to restore. */}
        {false && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Summary of Pricing</h4>
            <div className="space-y-4">
              <div className="p-3 bg-muted/50 rounded-lg border">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Total Price of Upfront (RM)</div>
                <div className="text-lg font-bold text-primary">{pricingSummary.totalUpfront.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Total Monthly Installment (RM)</div>
                <div className="text-lg font-bold text-primary">{pricingSummary.totalInstallment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <div className="p-3 bg-primary/5 rounded-lg border border-primary/20">
                <div className="text-[10px] uppercase text-primary/70 tracking-wider">Total TCV (RM)</div>
                <div className="text-lg font-bold text-primary">{pricingSummary.totalTCV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Summary of Costing</h4>
            <div className="space-y-4">
              <div className="space-y-2">
                <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total (RM) - One time cost services</h5>
                <div className="grid grid-cols-1 gap-1.5">
                  <div className="flex justify-between items-center p-2 bg-muted/30 rounded border text-[11px]">
                    <span className="text-muted-foreground">1. Total Cost</span>
                    <span className="font-semibold">{costingSummary.upfront.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-muted/30 rounded border text-[11px]">
                    <span className="text-muted-foreground">2. Total SST</span>
                    <span className="font-semibold">{costingSummary.upfront.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-primary/5 rounded border border-primary/20 text-[11px]">
                    <span className="text-primary font-medium">3. Total cost with SST</span>
                    <span className="font-bold text-primary">{costingSummary.upfront.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <h5 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Total (RM) - Annual services cost</h5>
                <div className="grid grid-cols-1 gap-1.5">
                  <div className="flex justify-between items-center p-2 bg-muted/30 rounded border text-[11px]">
                    <span className="text-muted-foreground">1. Total Cost</span>
                    <span className="font-semibold">{costingSummary.installment.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-muted/30 rounded border text-[11px]">
                    <span className="text-muted-foreground">2. Total SST</span>
                    <span className="font-semibold">{costingSummary.installment.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 bg-primary/5 rounded border border-primary/20 text-[11px]">
                    <span className="text-primary font-medium">3. Total cost with SST</span>
                    <span className="font-bold text-primary">{costingSummary.installment.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <div className="p-3 bg-muted/50 rounded-lg border">
                  <div className="text-[10px] uppercase text-muted-foreground tracking-wider">Total Cost of TCV (Excl. SST) (RM)</div>
                  <div className="text-lg font-bold">{costingSummary.tcv.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
                
                <div className="p-3 bg-primary/10 rounded-lg border border-primary/30">
                  <div className="text-[10px] uppercase text-primary/70 tracking-wider">Total Cost of TCV with SST (RM)</div>
                  <div className="text-lg font-bold text-primary">{costingSummary.tcv.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Tables Section */}
        <div className="grid grid-cols-1 gap-6">
        </div>

        {/* Final Decision Maker Section */}
        <Card className="print:break-inside-avoid relative group mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              Final Decision Maker
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="p-3 bg-muted/50 rounded-lg border">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Final Decision Maker</div>
                <div className="text-sm font-bold">{metadata.finalDecisionMaker || "-"}</div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Gross Margin (%)</div>
                <div className="text-sm font-bold text-primary">
                  {pricerMarginSummary.grossMarginPercentage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                </div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">EBITDA Margin (%)</div>
                <div className="text-sm font-bold text-cyan-600">
                  {pricerMarginSummary.ebitdaMarginPercentage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                </div>
              </div>
              <div className="p-3 bg-muted/50 rounded-lg border">
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Net Margin (%)</div>
                <div className="text-sm font-bold text-pink-600">
                  {pricerMarginSummary.netMarginPercentage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%
                </div>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t space-y-3">
              <h5 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Required Approval Workflow</h5>
              {(() => {
                const rank = metadata.finalDecisionAuthorityRank || "";
                let steps: { rank: string; role: string; desc: string }[] = [];
                let altInfo = "";

                if (rank.includes("Rank 1")) {
                  steps = [
                    { rank: "Rank 4", role: "Head of Sales", desc: "Initial Approval" },
                    { rank: "Rank 3", role: "Head of Commercial", desc: "Mid-level Review" },
                    { rank: "Rank 2", role: "CEBO", desc: "Executive Endorsement" },
                    { rank: "Rank 1", role: "CFO", desc: "Final Financial Approval" }
                  ];
                } else if (rank.includes("Rank 2")) {
                  steps = [
                    { rank: "Rank 4", role: "Head of Sales", desc: "Initial Approval" },
                    { rank: "Rank 3", role: "Head of Commercial", desc: "Mid-level Review" },
                    { rank: "Rank 2", role: "CEBO", desc: "Final Executive Approval" }
                  ];
                } else if (rank.includes("Rank 3")) {
                  steps = [
                    { rank: "Rank 4", role: "Head of Sales", desc: "Initial Review" },
                    { rank: "Rank 3", role: "Head of Commercial", desc: "Final Departmental Approval" }
                  ];
                } else {
                  steps = [
                    { rank: "Rank 4", role: "Head of Sales", desc: "Direct Final Approval" }
                  ];
                }

                return (
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-4 items-center">
                      {steps.map((step, idx) => (
                        <div key={step.rank} className="flex items-center gap-4">
                          {idx > 0 && (
                            <div className="text-muted-foreground font-bold text-lg animate-pulse">➔</div>
                          )}
                          <div className="flex items-center gap-3 p-2.5 bg-background border rounded-lg shadow-sm">
                            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {step.rank.replace("Rank ", "")}
                            </span>
                            <div>
                              <div className="text-xs font-semibold text-foreground">{step.role}</div>
                              <div className="text-[10px] text-muted-foreground">{step.desc}</div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                    {altInfo && (
                      <p className="text-xs text-muted-foreground bg-primary/5 p-2 rounded-md border border-primary/10 italic">
                        💡 {altInfo}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          </CardContent>
        </Card>

        {/* FINANCING - Reselling Third Parties Services — admin and Finance (rank1) only */}
        {(role === "admin" || role === "rank1") && (
        <Card className="print:break-inside-avoid relative group">
          <CardHeader className="pb-2 flex flex-row items-center justify-between">
            <CardTitle className="text-lg font-semibold flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              FINANCING - Reselling Third Parties Services
            </CardTitle>
          </CardHeader>
          <CardDescription className="px-6 pb-2">Details for third-party service reselling financing</CardDescription>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-6">
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Option</div>
                <div className="text-xl font-bold text-primary">{metadata.option || "-"}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">+ Total B2S (RM)</div>
                <div className="text-xl font-bold text-primary">
                  {metadata.option === "No" ? "0.00" : parseFloat(metadata.totalOneTimeChargeB2S || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">- Upfront (RM)</div>
                <div className="text-xl font-bold text-primary">
                  {metadata.option === "No" ? "0.00" : parseFloat(metadata.totalUpfrontPayment || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Financing Req (RM)</div>
                <div className="text-xl font-bold text-primary">
                  {metadata.option === "No" ? "0.00" : parseFloat(metadata.totalFinancingRequest || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Contract Period</div>
                <div className="text-xl font-bold text-primary">{metadata.option === "No" ? "-" : (metadata.contractPeriod || "-")}</div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Financing lease (RM)</div>
                <div className="text-xl font-bold text-primary">
                  {metadata.option === "No" ? "0.00" : parseFloat(metadata.financingLease || "0").toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
              <div className="space-y-1">
                <div className="text-[10px] uppercase text-muted-foreground font-bold tracking-wider">Total Financing lease (RM)</div>
                <div className="text-xl font-bold text-primary">
                  {metadata.option === "No" ? "0.00" : (parseFloat(metadata.financingLease || "0") * parseInt(metadata.contractPeriod || "0")).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Full Service Inventory */}
        <Card className="shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Full FA Request</CardTitle>
              <CardDescription>Comprehensive list of all items</CardDescription>
            </div>
            {role === "user" && (
              <div className="flex gap-2 print:hidden">
                <Button size="sm" variant="outline" onClick={() => openAddForm("one-time")} className="gap-1">
                  <Plus className="h-3 w-3" /> Add Part A
                </Button>
                <Button size="sm" variant="outline" onClick={() => openAddForm("annual")} className="gap-1">
                  <Plus className="h-3 w-3" /> Add Part B
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
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
                  <TableHead>Cost/unit</TableHead>
                  <TableHead>Total cost</TableHead>
                  <TableHead>Total SST (RM)</TableHead>
                  <TableHead>Sales Buffer %</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Level of Authority</TableHead>
                  {role === "user" && <TableHead className="text-right print:hidden">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {localServices.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={role === "user" ? 17 : 16} className="h-24 text-center text-muted-foreground">
                      No services found.
                    </TableCell>
                  </TableRow>
                ) : (
                  localServices.map((s, index) => (
                    <TableRow key={s.id}>
                      <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell className="max-w-[200px] truncate" title={s.description}>
                        {s.description}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{s.serviceType}</Badge>
                      </TableCell>
                      <TableCell>{s.units}</TableCell>
                      <TableCell>{s.years}</TableCell>
                      <TableCell>
                        {s.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        {s.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={s.decision === "Approved" ? "default" : s.decision === "Rejected" ? "destructive" : "outline"}>
                          {s.decision}
                        </Badge>
                      </TableCell>
                      <TableCell>{s.installmentPeriod}</TableCell>
                      <TableCell>
                        {s.costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        {s.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>
                        {s.totalSST.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </TableCell>
                      <TableCell>{s.salesBuffer.toFixed(2)}%</TableCell>
                      <TableCell>{s.entity}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="font-normal">{s.authorityLevel}</Badge>
                      </TableCell>
                      {role === "user" && (
                        <TableCell className="text-right print:hidden">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleEdit(s)}>
                              <Edit className="h-3.5 w-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => handleDelete(s.id)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
        </Card>



        {/* Global Actions at Bottom */}
        <div className="flex justify-center gap-4 pt-4 pb-12 print:hidden">
          <Button variant="outline" size="lg" className="w-48" onClick={() => navigate(-1)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
          </Button>
          {role === "user" && (
            <Button 
              size="lg"
              className={`w-56 ${isConfirmed && !existingOrder ? 'bg-green-500' : 'bg-green-600 hover:bg-green-700'} text-white border-none`}
              onClick={handleConfirm} 
              disabled={isConfirmed && !existingOrder}
            >
              {isConfirmed && !existingOrder ? (
                <>
                  <CheckCircle2 className="mr-2 h-5 w-5" /> Confirmed
                </>
              ) : existingOrder ? (
                <>
                  <Save className="mr-2 h-5 w-5" /> Update Report
                </>
              ) : (
                <>
                  <CheckCircle2 className="mr-2 h-5 w-5" /> Save As Draft
                </>
              )}
            </Button>
          )}
        </div>

        {/* Form Dialog */}
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <ServiceForm
            category={addingCategory}
            initialData={editingService}
            metadata={metadata}
            onSubmit={handleAddService}
            onCancel={() => setIsFormOpen(false)}
          />
        </Dialog>

        {/* Delete Confirmation Dialog */}
        <Dialog open={isDeleteConfirmOpen} onOpenChange={setIsDeleteConfirmOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Confirm Deletion</DialogTitle>
              <DialogDescription>
                Are you sure you want to remove this service?
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      </div>
    </div>
  );
}