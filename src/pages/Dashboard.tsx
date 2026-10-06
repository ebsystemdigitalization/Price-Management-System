import React, { useState, useMemo, useEffect } from "react";
import { Service, ServiceCategory, OrderMetadata, Attachment, CONTRACT_TYPES, CURRENCIES, AUTHORITY_LEVELS, INITIAL_METADATA } from "../types";
import { ServiceList } from "../components/ServiceList";
import { ServiceForm } from "../components/ServiceForm";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutDashboard, Receipt, CalendarClock, TrendingUp, Wallet, FileText, FileSpreadsheet, ExternalLink, ArrowLeft, Info, User, Paperclip, X, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import Header from "../components/Header";
import { storage } from "../firebase";
import { ref, uploadBytesResumable, deleteObject } from "firebase/storage";
import { openAttachment } from "../lib/attachments";
import { useAuth } from "../context/AuthContext";
import { DatePicker } from "@/components/DatePicker";

interface DashboardProps {
  services: Service[];
  setServices: React.Dispatch<React.SetStateAction<Service[]>>;
  metadata: OrderMetadata;
  setMetadata: React.Dispatch<React.SetStateAction<OrderMetadata>>;
}

export default function Dashboard({ services, setServices, metadata, setMetadata }: DashboardProps) {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // "New FA Request" links here with ?new=1 to explicitly clear any leftover
  // in-progress draft, rather than silently resuming whatever was last saved.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      setServices([]);
      setMetadata(INITIAL_METADATA);
      setSearchParams({}, { replace: true });
    }
  }, []);
 const { currentUser, role } = useAuth();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<{ id: string; name: string; progress: number }[]>([]);

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const handleFileUpload = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0 || !currentUser) return;

    Array.from(fileList).forEach((file) => {
      const isPdf = file.type === "application/pdf";
      const isExcel =
        file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
        file.type === "application/vnd.ms-excel";

      if (!isPdf && !isExcel) {
        toast.error(`${file.name}: only PDF and Excel files are allowed`);
        return;
      }

      const maxSize = 100 * 1024 * 1024;
      if (file.size > maxSize) {
        toast.error(`${file.name}: exceeds the 100MB limit for ${isPdf ? "PDF" : "Excel"} files`);
        return;
      }

      const attachmentId = crypto.randomUUID();
      setUploadingFiles((prev) => [...prev, { id: attachmentId, name: file.name, progress: 0 }]);

      const storagePath = `draft-attachments/${currentUser.uid}/${attachmentId}-${file.name}`;
      const storageRef = ref(storage, storagePath);
      const uploadTask = uploadBytesResumable(storageRef, file);

      uploadTask.on(
        "state_changed",
        (snapshot) => {
          const progress = Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100);
          setUploadingFiles((prev) => prev.map((f) => (f.id === attachmentId ? { ...f, progress } : f)));
        },
        (error) => {
          console.error("Attachment upload failed:", error);
          toast.error(`Failed to upload ${file.name}`);
          setUploadingFiles((prev) => prev.filter((f) => f.id !== attachmentId));
        },
        async () => {
          // FIND-01: deliberately no getDownloadURL call. That call mints a
          // permanent, rules-bypassing access token on the object; the URL is
          // now resolved on demand through the getAttachmentUrl callable.
          const newAttachment: Attachment = {
            id: attachmentId,
            name: file.name,
            path: storagePath,
            size: file.size,
            type: isPdf ? "pdf" : "excel",
            uploadedAt: new Date().toISOString(),
          };
          setMetadata((prev) => ({ ...prev, attachments: [...(prev.attachments || []), newAttachment] }));
          setUploadingFiles((prev) => prev.filter((f) => f.id !== attachmentId));
          toast.success(`${file.name} uploaded`);
        }
      );
    });
  };

  const handleRemoveAttachment = async (attachment: Attachment) => {
    try {
      await deleteObject(ref(storage, attachment.path));
    } catch (err) {
      console.error("Failed to delete attachment from storage:", err);
    }
    setMetadata((prev) => ({ ...prev, attachments: (prev.attachments || []).filter((a) => a.id !== attachment.id) }));
    toast.success(`${attachment.name} removed`);
  };
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [serviceToDelete, setServiceToDelete] = useState<string | null>(null);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [activeCategory, setActiveCategory] = useState<ServiceCategory>("one-time");

  // Combined Summary margin figures — mirrors the exact formula in
  // SummaryReport.tsx's pricerMarginSummary (colleague-owned calc logic,
  // reproduced here unmodified so Combined Summary can show it live).
  const oneTimeCostWithSST = useMemo(() => {
    return services
      .filter((s) => s.category === "one-time")
      .reduce((acc, s) => acc + s.totalCost + s.totalSST, 0);
  }, [services]);

  const marginSummary = useMemo(() => {
    const totals = services.reduce((acc, s) => {
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
        ebitda: acc.ebitda + ebitda,
        netMargin: acc.netMargin + netMargin,
      };
    }, {
      tcv: 0,
      ebitda: 0,
      netMargin: 0,
    });

    const ebitdaMarginPercentage = totals.tcv > 0 ? (totals.ebitda / totals.tcv) * 100 : 0;
    const netMarginPercentage = totals.tcv > 0 ? (totals.netMargin / totals.tcv) * 100 : 0;

    return {
      ebitda: totals.ebitda,
      netMargin: totals.netMargin,
      ebitdaMarginPercentage,
      netMarginPercentage,
    };
  }, [services, metadata, oneTimeCostWithSST]);

  const handleAddService = (data: any) => {
    const newService: Service = {
      ...data,
      id: editingService?.id || crypto.randomUUID(),
      category: activeCategory,
      createdAt: editingService?.createdAt || Date.now(),
      updatedAt: Date.now(),
    };

    if (editingService) {
      setServices(services.map((s) => (s.id === editingService.id ? newService : s)));
      toast.success("Service updated successfully");
    } else {
      setServices([...services, newService]);
      toast.success("Service added successfully");
    }

    setIsFormOpen(false);
    setEditingService(null);
  };

  const handleDeleteService = (id: string) => {
    setServiceToDelete(id);
    setIsDeleteConfirmOpen(true);
  };

  const confirmDelete = () => {
    if (serviceToDelete) {
      setServices(services.filter((s) => s.id !== serviceToDelete));
      toast.success("Service deleted");
      setIsDeleteConfirmOpen(false);
      setServiceToDelete(null);
    }
  };

  const handleEdit = (service: Service) => {
    setEditingService(service);
    setIsFormOpen(true);
  };

  const handleAdd = () => {
    setEditingService(null);
    setIsFormOpen(true);
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

  const pricingSummary = useMemo(() => {
    const totalUpfront = services.reduce((acc, s) => acc + s.outrightPrice, 0);
    const totalInstallment = Math.round(services.reduce((acc, s) => acc + s.monthlyRevenue, 0));
    const totalTCV = services.reduce((acc, s) => {
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
  }, [services]);

  const costingSummary = useMemo(() => {
    return services.reduce((acc, s) => {
      if (s.decision === "Upfront Payment") {
        acc.upfront.cost += s.totalCost;
        acc.upfront.sst += s.totalSST;
        acc.upfront.total += (s.totalCost + s.totalSST);
      } else if (s.decision === "Installment Plan") {
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
  }, [services]);

  const pricingMarginSummary = useMemo(() => {
    const revenue = pricingSummary.totalTCV;
    const cost = costingSummary.tcv.total;
    const grossMarginRM = revenue - cost;
    const grossMarginPercentage = revenue !== 0 ? (grossMarginRM / revenue) * 100 : 0;
    return { grossMarginRM, grossMarginPercentage };
  }, [pricingSummary.totalTCV, costingSummary.tcv.total]);

  const stats = useMemo(() => {
    const current = services.filter((s) => s.category === activeCategory);
    const totalRevenue = current.reduce((acc, s) => acc + s.outrightPrice + s.totalInstallmentPayment, 0);
    return {
      totalRevenue,
      totalCost: current.reduce((acc, s) => acc + s.totalCost, 0),
      totalSST: current.reduce((acc, s) => acc + s.totalSST, 0),
      count: current.length,
    };
  }, [services, activeCategory]);

  // Handle automated metadata updates
  React.useEffect(() => {
    const upfront = Math.round(pricingSummary.totalUpfront);
    
    // Auto-calculate B2S based on One-Time cost services if Option is Yes
    const oneTimeCostWithSST = services.reduce((acc, s) => {
      if (s.category === 'one-time') {
        return acc + s.totalCost + s.totalSST;
      }
      return acc;
    }, 0);
    
    // Auto-set Option to Yes if oneTimeCostWithSST > upfront, otherwise No
    const autoOption = oneTimeCostWithSST > upfront ? "Yes" : "No";
    const b2s = Math.round(autoOption === "Yes" ? oneTimeCostWithSST : 0);
    const request = Math.round(Math.max(0, b2s - upfront));

    // Consolidated Final Decision Maker logic
    let lowestRankNum = 99;
    let autoDecisionMaker = "Head of Sales";
    let autoAuthorityRank = "Rank 4";

    // 1. Evaluate services
    services.forEach(s => {
      if (s.authorityRank) {
        const rankMatch = s.authorityRank.match(/Rank (\d+)/);
        if (rankMatch) {
          const num = parseInt(rankMatch[1]);
          if (num < lowestRankNum) {
            lowestRankNum = num;
            autoDecisionMaker = s.authorityLevel === "Head ES & BP" ? "Head of Commercial" : (s.authorityLevel === "Approved" ? "Head of Sales" : (s.authorityLevel || "Head of Sales"));
            autoAuthorityRank = s.authorityRank || "Rank 4";
          }
        }
      }
    });

    // 2. Evaluate Financing factors
    const leaseTerm = parseInt(metadata.contractPeriod || "0");
    if (autoOption === "Yes" && request > 0) {
      let leaseRank = 99;
      let leaseLevel = "";
      
      if (leaseTerm > 36) { leaseRank = 1; leaseLevel = "Finance"; }
      else if (leaseTerm > 24) { leaseRank = 2; leaseLevel = "CEBO"; }
      else if (leaseTerm > 12) { leaseRank = 3; leaseLevel = "Head of Commercial"; }
      
      if (leaseRank < lowestRankNum) {
        lowestRankNum = leaseRank;
        autoDecisionMaker = leaseLevel;
        autoAuthorityRank = `Rank ${leaseRank}`;
      }

      // Zero upfront check
      if (upfront === 0) {
        if (1 < lowestRankNum) {
          lowestRankNum = 1;
          autoDecisionMaker = "Finance";
          autoAuthorityRank = "Rank 1";
        }
      }
    }

    if (lowestRankNum === 99) {
      lowestRankNum = 4;
      autoDecisionMaker = "Head of Sales";
      autoAuthorityRank = "Rank 4";
    }

    // Auto-calculate Contract Period: Highest installment period among all services
    const maxContractTenure = services.length > 0 
      ? Math.max(...services.map(s => s.installmentPeriod || 0))
      : 0;

    const n = (autoOption === "Yes" && maxContractTenure > 0) ? maxContractTenure : parseInt(metadata.contractPeriod || "0");
    let autoFinancingLease = 0;
    if (autoOption === "Yes" && request > 0 && n > 0) {
      const r = 0.05 / 12;
      const pmt = (request * r) / (1 - Math.pow(1 + r, -n));
      const monthlyPrincipal = request / n;
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
  }, [pricingSummary.totalUpfront, services, metadata.contractPeriod, metadata.totalOneTimeChargeB2S, metadata.totalUpfrontPayment, metadata.totalFinancingRequest, metadata.finalDecisionMaker, metadata.finalDecisionAuthorityRank, metadata.financingLease, metadata.option, setMetadata]);

  const orderDetailsCard = (
    <Card>
      <CardHeader>
        <CardTitle>Order Details</CardTitle>
        <CardDescription>Summary of combined services</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 bg-muted/50 rounded-lg border text-center">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Part A (One Time)</div>
            <div className="text-2xl font-bold">{services.filter(s => s.category === "one-time").length}</div>
            <div className="text-xs text-muted-foreground">items</div>
          </div>
          <div className="p-3 bg-muted/50 rounded-lg border text-center">
            <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Part B (Annual)</div>
            <div className="text-2xl font-bold">{services.filter(s => s.category === "annual").length}</div>
            <div className="text-xs text-muted-foreground">items</div>
          </div>
          <div className="p-3 bg-primary/10 border-primary/30 rounded-lg border text-center">
            <div className="text-[10px] uppercase text-primary/70 tracking-wider mb-1">Total</div>
            <div className="text-2xl font-bold text-primary">{services.length}</div>
            <div className="text-xs text-primary/70">items</div>
          </div>
        </div>

        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Financial Performance</h4>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-4 bg-primary/5 border-primary/20 rounded-lg border flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase text-primary/70 tracking-wider mb-1">Gross Margin</div>
                <div className="text-2xl font-bold text-primary">{(Math.ceil(pricingMarginSummary.grossMarginPercentage * 10) / 10).toFixed(1)}%</div>
                <div className="text-xs text-primary/60 font-medium">RM {pricingMarginSummary.grossMarginRM.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
              </div>
              <TrendingUp className="h-6 w-6 text-primary/50" />
            </div>
            <div className="p-4 bg-muted/50 rounded-lg border flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">EBITDA Margin</div>
                <div className="text-2xl font-bold text-cyan-600">{marginSummary.ebitdaMarginPercentage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</div>
              </div>
              <TrendingUp className="h-6 w-6 text-cyan-600/50" />
            </div>
            <div className="p-4 bg-muted/50 rounded-lg border flex items-center justify-between">
              <div>
                <div className="text-[10px] uppercase text-muted-foreground tracking-wider mb-1">Net Margin</div>
                <div className="text-2xl font-bold text-pink-600">{marginSummary.netMarginPercentage.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</div>
              </div>
              <Wallet className="h-6 w-6 text-pink-600/50" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );

  return (
    <div className="min-h-screen bg-muted/30 font-sans">
      <Header />
      <div className="p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
          <div className="space-y-1">
            <h1 className="text-3xl font-bold tracking-tight flex items-center gap-2">
              <LayoutDashboard className="h-8 w-8 text-primary" />
              Pricing Management
            </h1>
            <p className="text-muted-foreground">
              
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back
            </Button>
          </div>
        </header>

        <Card>
          {/* Project Information */}
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Info className="h-5 w-5 text-primary" />
                Project Information
              </CardTitle>
              <CardDescription>Enter the request details for this FA request.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="servicesProducts">Services/Products <span className="text-destructive">*</span></Label>
                <Input 
                  id="servicesProducts" 
                  value={metadata.servicesProducts || ""} 
                  onChange={(e) => handleMetadataChange("servicesProducts", e.target.value)}
                  placeholder="e.g. Cloud Infrastructure"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name <span className="text-destructive">*</span></Label>
                <Input 
                  id="companyName" 
                  value={metadata.companyName || ""} 
                  onChange={(e) => handleMetadataChange("companyName", e.target.value)}
                  placeholder="e.g. Acme Corp"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="accountManager">Account Manager <span className="text-destructive">*</span></Label>
                <Input 
                  id="accountManager" 
                  value={metadata.accountManager || ""} 
                  onChange={(e) => handleMetadataChange("accountManager", e.target.value)}
                  placeholder="Name of manager"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="regionalManager">Regional Manager <span className="text-destructive">*</span></Label>
                <Input 
                  id="regionalManager" 
                  value={metadata.regionalManager || ""} 
                  onChange={(e) => handleMetadataChange("regionalManager", e.target.value)}
                  placeholder="Name of regional manager"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="headOfDepartment">Head of Department <span className="text-destructive">*</span></Label>
                <Select
                  value={metadata.headOfDepartment || ""}
                  onValueChange={(v) => handleMetadataChange("headOfDepartment", v)}
                >
                  <SelectTrigger id="headOfDepartment" className="w-full h-auto min-h-8 py-1.5 whitespace-normal break-words [&&_[data-slot=select-value]]:line-clamp-none [&&_[data-slot=select-value]]:whitespace-normal">
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
              <div className="space-y-2">
                <Label htmlFor="pricer">Pricer <span className="text-destructive">*</span></Label>
                <Input 
                  id="pricer" 
                  value={metadata.pricer || ""} 
                  onChange={(e) => handleMetadataChange("pricer", e.target.value)}
                  placeholder="Name of pricer"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="solutionArchitect">Solution Architect <span className="text-destructive">*</span></Label>
                <Input 
                  id="solutionArchitect" 
                  value={metadata.solutionArchitect || ""} 
                  onChange={(e) => handleMetadataChange("solutionArchitect", e.target.value)}
                  placeholder="Name of architect"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="salesforceId">S/ Force/ FA ID <span className="text-destructive">*</span></Label>
                <Input 
                  id="salesforceId" 
                  value={metadata.salesforceId || ""} 
                  onChange={(e) => handleMetadataChange("salesforceId", e.target.value)}
                  placeholder="Enter ID"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="vendorName">Vendor Name <span className="text-destructive">*</span></Label>
                <Input 
                  id="vendorName" 
                  value={metadata.vendorName || ""} 
                  onChange={(e) => handleMetadataChange("vendorName", e.target.value)}
                  placeholder="Enter vendor name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="businessDevelop">Business Development <span className="text-destructive">*</span></Label>
                <Input 
                  id="businessDevelop" 
                  value={metadata.businessDevelop || ""} 
                  onChange={(e) => handleMetadataChange("businessDevelop", e.target.value)}
                  placeholder="Name of BD"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="preSales">Pre-Sales <span className="text-destructive">*</span></Label>
                <Input 
                  id="preSales" 
                  value={metadata.preSales || ""} 
                  onChange={(e) => handleMetadataChange("preSales", e.target.value)}
                  placeholder="Name of pre-sales"
                />
              </div>
              <div className="space-y-2">
                <Label>Subjected to CIDB levy</Label>
                <Select 
                  value={metadata.cidbLevy || "No"} 
                  onValueChange={(v) => handleMetadataChange("cidbLevy", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subjected to stamp duty</Label>
                <Select 
                  value={metadata.stampDuty || "No"} 
                  onValueChange={(v) => handleMetadataChange("stampDuty", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Yes">Yes</SelectItem>
                    <SelectItem value="No">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Subjected to E-Perolehan</Label>
                <Select 
                  value={metadata.ePerolehan || "No"} 
                  onValueChange={(v) => handleMetadataChange("ePerolehan", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="No">No</SelectItem>
                    <SelectItem value="0.8%">0.8%</SelectItem>
                    <SelectItem value="0.4%">0.4%</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="solutionServiceType">Solution service type <span className="text-destructive">*</span></Label>
                <Select
                  value={metadata.solutionServiceType || ""}
                  onValueChange={(v) => handleMetadataChange("solutionServiceType", v)}
                >
                  <SelectTrigger id="solutionServiceType">
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
              <div className="space-y-2">
                <Label htmlFor="date">Date <span className="text-destructive">*</span></Label>
                <DatePicker
                  id="date"
                  value={metadata.date || ""}
                  onChange={(v) => handleMetadataChange("date", v)}
                />
              </div>
              <div className="space-y-2">
                <Label>Contract Type <span className="text-destructive">*</span></Label>
                <Select 
                  value={metadata.contractType || "New Contract"} 
                  onValueChange={(v) => handleMetadataChange("contractType", v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {CONTRACT_TYPES.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="currency">Currency <span className="text-destructive">*</span></Label>
                <Select
                  value={metadata.currency || "Malaysian Ringgit"}
                  onValueChange={(v) => handleMetadataChange("currency", v)}
                >
                  <SelectTrigger id="currency">
                    <SelectValue placeholder="Select currency" />
                  </SelectTrigger>
                  <SelectContent>
                    {CURRENCIES.map(c => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="exchangeRate">Exchange rate (1 unit foreign currency) <span className="text-destructive">*</span></Label>
                <Input 
                      value={metadata.exchangeRate ?? "1.00"} 
                      onChange={(e) => handleMetadataChange("exchangeRate", e.target.value)}
                      className="h-8 text-sm"
                    />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="projectBrief">Project Brief <span className="text-destructive">*</span></Label>
                <Textarea 
                  id="projectBrief" 
                  value={metadata.projectBrief || ""} 
                  onChange={(e) => handleMetadataChange("projectBrief", e.target.value)}
                  placeholder="Short description of the project..."
                  className="min-h-[100px]"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="justification">Justification for approval <span className="text-destructive">*</span></Label>
                <Textarea 
                  id="justification" 
                  value={metadata.justification || ""} 
                  onChange={(e) => handleMetadataChange("justification", e.target.value)}
                  placeholder="Why should this be approved?"
                  className="min-h-[100px]"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Attachments</Label>
                <div className="border rounded-lg p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-muted-foreground">
                      PDF or Excel (max 100MB each). You can add multiple files.
                    </p>
                    <Button type="button" variant="outline" size="sm" asChild>
                      <label className="cursor-pointer">
                        <Paperclip className="h-4 w-4 mr-2" />
                        Add Attachment
                        <input
                          type="file"
                          multiple
                          accept=".pdf,.xlsx,.xls"
                          className="hidden"
                          onChange={(e) => {
                            handleFileUpload(e.target.files);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    </Button>
                  </div>

                  {(metadata.attachments && metadata.attachments.length > 0) || uploadingFiles.length > 0 ? (
                    <div className="space-y-2">
                      {metadata.attachments?.map((attachment) => (
                        <div key={attachment.id} className="flex items-center justify-between p-2 bg-muted/50 rounded border">
                          <div className="flex items-center gap-2 min-w-0">
                            {attachment.type === "pdf" ? (
                              <FileText className="h-4 w-4 text-red-600 shrink-0" />
                            ) : (
                              <FileSpreadsheet className="h-4 w-4 text-green-600 shrink-0" />
                            )}
                            <button
                              type="button"
                              onClick={() =>
                                openAttachment({ mode: "draft", path: attachment.path }).catch((e) =>
                                  toast.error(e?.message || "Could not open attachment.")
                                )
                              }
                              className="text-sm font-medium truncate hover:underline text-left"
                            >
                              {attachment.name}
                            </button>
                            <span className="text-xs text-muted-foreground shrink-0">
                              {formatFileSize(attachment.size)}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 shrink-0"
                            onClick={() => handleRemoveAttachment(attachment)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                      ))}
                      {uploadingFiles.map((f) => (
                        <div key={f.id} className="flex items-center gap-2 p-2 bg-muted/30 rounded border">
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />
                          <span className="text-sm truncate flex-1">{f.name}</span>
                          <span className="text-xs text-muted-foreground shrink-0">{f.progress}%</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">No attachments yet.</p>
                  )}
                </div>
              </div>
            </CardContent>
        </Card>

        {/* Final Decision Maker */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5 text-primary" />
              Final Decision Maker
            </CardTitle>
            <CardDescription>Details of the final approving authority for this costing.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="finalDecisionMaker">Final Decision Maker</Label>
                <div className="relative">
                  <Input 
                    id="finalDecisionMaker"
                    value={metadata.finalDecisionMaker || "-"}
                    readOnly
                    className="bg-muted font-bold text-primary"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Visible to admin and Finance (rank1) only. */}
        {(role === "admin" || role === "rank1") && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Wallet className="h-5 w-5 text-primary" />
              FINANCING - Reselling Third Parties Services
            </CardTitle>
            <CardDescription>Manage financing details for third-party service reselling.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-4">
              <div className="space-y-2">
                <Label htmlFor="totalOneTimeChargeB2S">+ Total One time charge B2S (RM)</Label>
                <div className="relative">
                  <Input 
                    id="totalOneTimeChargeB2S"
                    type="number"
                    value={metadata.option === "No" ? "0" : (metadata.totalOneTimeChargeB2S || "0")}
                    readOnly
                    className="bg-muted pr-20"
                  />
                  <div className="absolute right-3 top-2.5 text-[10px] text-muted-foreground uppercase font-bold">Auto-Sync</div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalUpfrontPayment">- Total Upfront payment (RM)</Label>
                <div className="relative">
                  <Input 
                    id="totalUpfrontPayment"
                    type="number"
                    value={metadata.option === "No" ? "0" : (metadata.totalUpfrontPayment || "0")}
                    readOnly
                    className="bg-muted pr-20"
                  />
                  <div className="absolute right-3 top-2.5 text-[10px] text-muted-foreground uppercase font-bold">Auto-Sync</div>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalFinancingRequest">Total financing request (RM)</Label>
                <Input 
                  id="totalFinancingRequest"
                  value={metadata.option === "No" ? "0" : (metadata.totalFinancingRequest || "0")}
                  readOnly
                  className="bg-muted font-bold text-primary"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="contractPeriod">Contract Period (Months)</Label>
                <Input 
                  id="contractPeriod"
                  type="number"
                  value={metadata.option === "No" ? "" : (metadata.contractPeriod || "0")}
                  onChange={(e) => handleMetadataChange("contractPeriod", e.target.value)}
                  readOnly={metadata.option === "No"}
                  className={metadata.option === "No" ? "bg-muted" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="financingLease">Financing lease (RM)</Label>
                <Input 
                  id="financingLease"
                  type="number"
                  value={metadata.option === "No" ? "0" : (metadata.financingLease || "0")}
                  onChange={(e) => handleMetadataChange("financingLease", e.target.value)}
                  readOnly={metadata.option === "No"}
                  className={metadata.option === "No" ? "bg-muted" : ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalFinancingLease">Total Financing lease (RM)</Label>
                <Input 
                  id="totalFinancingLease"
                  value={metadata.option === "No" ? "0.00" : (parseFloat(metadata.financingLease || "0") * parseInt(metadata.contractPeriod || "0")).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  readOnly
                  className="bg-muted font-bold text-primary"
                />
              </div>
            </div>
          </CardContent>
        </Card>
        )}

        {/* Main Content */}
        <Tabs defaultValue="one-time" onValueChange={(v) => {
          if (v !== "summary") setActiveCategory(v as ServiceCategory);
        }} className="space-y-6">
          <TabsList className="grid w-full grid-cols-3 max-w-xl">
            <TabsTrigger value="one-time" className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4" />
              Part A: One Time
            </TabsTrigger>
            <TabsTrigger value="annual" className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Part B: Annual
            </TabsTrigger>
            <TabsTrigger value="summary" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Combined Summary
            </TabsTrigger>
          </TabsList>

          <TabsContent value="one-time" className="space-y-4">
            {orderDetailsCard}

            <Card>
              <CardHeader>
                <CardTitle>One Time Cost Services (Part A)</CardTitle>
                <CardDescription>Manage your one-time implementation and setup costs.</CardDescription>
              </CardHeader>
              <CardContent>
                <ServiceList
                  category="one-time"
                  services={services.filter(s => s.category === "one-time")}
                  onEdit={handleEdit}
                  onDelete={handleDeleteService}
                  onAdd={handleAdd}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="annual" className="space-y-4">
            {orderDetailsCard}

            <Card>
              <CardHeader>
                <CardTitle>Annual Services Cost (Part B)</CardTitle>
                <CardDescription>Manage your recurring annual service and maintenance costs.</CardDescription>
              </CardHeader>
              <CardContent>
                <ServiceList
                  category="annual"
                  services={services.filter(s => s.category === "annual")}
                  onEdit={handleEdit}
                  onDelete={handleDeleteService}
                  onAdd={handleAdd}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="summary" className="space-y-6">
            <div className="space-y-6">
            {orderDetailsCard}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="flex flex-col">
                  <CardHeader className="pt-6">
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-primary" />
                      Summary of Pricing
                    </CardTitle>
                    <CardDescription>Calculated totals based on payment terms.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                      <div className="text-[10px] uppercase text-muted-foreground">Total Revenue</div>
                      <div className="text-lg font-bold text-primary">
                        RM {pricingSummary.totalTCV.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </div>
                    </div>
                    <Separator />
                    <div className="grid grid-cols-2 gap-3">
                       <div>
                          <div className="text-[10px] uppercase text-muted-foreground">Upfront Price</div>
                          <div className="font-semibold text-primary">RM {pricingSummary.totalUpfront.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                       </div>
                       <div>
                          <div className="text-[10px] uppercase text-muted-foreground">Monthly Rev</div>
                          <div className="font-semibold text-primary">RM {pricingSummary.totalInstallment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                       </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="flex flex-col">
                  <CardHeader className="pt-6">
                    <CardTitle className="flex items-center gap-2">
                      <Receipt className="h-5 w-5 text-primary" />
                      Summary of Costing
                    </CardTitle>
                    <CardDescription>Calculated vendor costs including SST.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="p-3 rounded-lg bg-primary/5 border border-primary/10">
                      <div className="text-[10px] uppercase text-muted-foreground">Overall Total Cost (SST)</div>
                      <div className="text-lg font-bold text-primary">RM {costingSummary.tcv.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                      <div className="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-primary/10">
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Without SST</div>
                          <div className="text-xs font-semibold">RM {costingSummary.tcv.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                        <div>
                          <div className="text-[9px] uppercase text-muted-foreground">Overall SST</div>
                          <div className="text-xs font-semibold">RM {costingSummary.tcv.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-muted/50 border">
                        <div className="text-[10px] uppercase text-muted-foreground">One-Time (Part A)</div>
                        <div className="text-base font-bold">RM {costingSummary.upfront.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">Cost</span>
                            <span className="font-semibold text-muted-foreground">RM {costingSummary.upfront.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">SST</span>
                            <span className="font-semibold text-muted-foreground">RM {costingSummary.upfront.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>

                      <div className="p-3 rounded-lg bg-muted/50 border">
                        <div className="text-[10px] uppercase text-muted-foreground">Annual (Part B)</div>
                        <div className="text-base font-bold">RM {costingSummary.installment.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        <div className="mt-2 pt-2 border-t border-border/50 space-y-1">
                          <div className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">Cost</span>
                            <span className="font-semibold text-muted-foreground">RM {costingSummary.installment.cost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                          <div className="flex justify-between text-[10px]">
                            <span className="text-muted-foreground">SST</span>
                            <span className="font-semibold text-muted-foreground">RM {costingSummary.installment.sst.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Combined Service List</CardTitle>
                <CardDescription>All services included in the order</CardDescription>
              </CardHeader>
              <CardContent>
                <ServiceList
                  category="one-time"
                  services={services}
                  onEdit={handleEdit}
                  onDelete={handleDeleteService}
                  onAdd={handleAdd}
                />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Back / View Full Report */}
        <div className="flex justify-center gap-2 pt-4 border-t">
          <Button variant="ghost" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back
          </Button>
          <Button asChild className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white border-none">
            <Link to="/report">
              <ExternalLink className="h-4 w-4" />
              View Full Summary
            </Link>
          </Button>
        </div>

        {/* Form Dialog */}
        <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
          <ServiceForm
            category={activeCategory}
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
                Are you sure you want to delete this service? This action cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setIsDeleteConfirmOpen(false)}>Cancel</Button>
              <Button variant="destructive" onClick={confirmDelete}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Toaster position="top-right" richColors />
      </div>
      </div>
    </div>
  );
}
