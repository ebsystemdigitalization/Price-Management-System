import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Service, ServiceCategory, SERVICE_TYPES, DECISIONS, ENTITIES, AUTHORITY_LEVELS, INSTALLMENT_PERIODS } from "@/src/types";
import { Button } from "@/components/ui/button";
import {
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useMemo } from "react";

const formSchema = z.object({
  name: z.string().min(1, "Service name is required"),
  description: z.string().min(1, "Description is required"),
  serviceType: z.string().min(1, "Service type is required"),
  units: z.number({ error: "No of units is required" }).min(1, "No of units must be at least 1"),
  years: z.number({ error: "No of years is required" }).min(1, "No of years must be at least 1"),
  outrightPrice: z.number().min(0),
  monthlyRevenue: z.number().min(0),
  totalInstallmentPayment: z.number().min(0),
  tcv: z.number().min(0),
  decision: z.string().min(1, "Decision is required"),
  installmentPeriod: z.number({ error: "Contract period is required" }).min(0, "Contract period is required"),
  costPerUnit: z.number({ error: "Cost/unit is required" }).min(0, "Cost/unit is required"),
  totalCost: z.number().min(0),
  sstRate: z.number({ error: "SST rate is required" }).min(0, "SST rate is required"),
  totalSST: z.number().min(0),
  salesBuffer: z.number({ error: "Sales buffer is required" }).min(0, "Sales buffer is required"),
  entity: z.string().min(1, "Entity is required"),
  authorityLevel: z.string().min(1, "Authority level is required"),
  authorityRank: z.string().min(1, "Level of authority rank is required"),
});

type FormValues = z.infer<typeof formSchema>;

interface ServiceFormProps {
  category: ServiceCategory;
  initialData?: Service | null;
  metadata: any; // Using any for simplicity or import OrderMetadata
  onSubmit: (data: FormValues) => void;
  onCancel: () => void;
}

export function ServiceForm({ category, initialData, metadata, onSubmit, onCancel }: ServiceFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialData || {
      name: "",
      description: "",
      serviceType: SERVICE_TYPES[0],
      units: 1,
      years: 1,
      outrightPrice: 0,
      monthlyRevenue: 0,
      totalInstallmentPayment: 0,
      decision: DECISIONS[0],
      installmentPeriod: 12,
      costPerUnit: 0,
      totalCost: 0,
      sstRate: 6,
      totalSST: 0,
      salesBuffer: 0,
      tcv: 0,
      entity: ENTITIES[0],
      authorityLevel: AUTHORITY_LEVELS[0],
      authorityRank: "",
    },
  });

  useEffect(() => {
    if (initialData) {
      reset(initialData);
    }
  }, [initialData, reset]);

  // Auto-calculate total cost, SST, Outright Price, and Monthly Installment
  const units = watch("units");
  const costPerUnit = watch("costPerUnit");
  const sstRate = watch("sstRate");
  const years = watch("years");
  const salesBuffer = watch("salesBuffer");
  const decision = watch("decision");
  const installmentPeriod = watch("installmentPeriod");

  useEffect(() => {
    const total = category === "one-time"
      ? Math.round(units * costPerUnit * years * 100) / 100
      : Math.round(units * costPerUnit * years);
    const sst = category === "one-time"
      ? Math.round(((total * sstRate) / 100) * 100) / 100
      : Math.round((total * sstRate) / 100);
    setValue("totalCost", total);
    setValue("totalSST", sst);
    
    // Calculate Outright Purchase Price: (Total Cost + Total SST) / (1 - Sales Buffer %)
    const bufferDecimal = salesBuffer / 100;
    let baseOutrightPrice = 0;
    if (bufferDecimal < 1) {
      // Formula: Outright Purchase Price (RM) = (Total Cost + Total SST (RM)) / (1 - Sales Buffer)
      const rawPrice = (total + sst) / (1 - bufferDecimal);
      baseOutrightPrice = Math.round(rawPrice * 100) / 100;
    }
    
    if (decision === "Installment Plan") {
      setValue("outrightPrice", 0);
    } else {
      // If user select Upfront Payment in Decision
      setValue("outrightPrice", baseOutrightPrice);
    }

    // Calculate Monthly Installment Revenue and Total Installment Payment if Installment Plan is selected
    let calculatedMonthlyRevenue = 0;
    let calculatedTotalInstallment = 0;

    if (decision === "Installment Plan" && installmentPeriod > 0 && baseOutrightPrice > 0) {
      if (category === "annual") {
        // Part B: 
        // Monthly Installment Revenue = ((Total Cost + Total SST) / (1 - Sales Buffer)) / Installment contract period
        calculatedMonthlyRevenue = Math.round((baseOutrightPrice / installmentPeriod) * 100) / 100;
        // Total Installment Payment = Monthly Installment Revenue * Installment contract period
        calculatedTotalInstallment = Math.round((calculatedMonthlyRevenue * installmentPeriod) * 100) / 100;
      } else {
        // Part A: PMT formula with 5% interest
        const annualRate = 0.05;
        const monthlyRate = annualRate / 12;
        const n = installmentPeriod;
        
        // PMT formula: (P * r * (1 + r)^n) / ((1 + r)^n - 1)
        const pmt = (baseOutrightPrice * monthlyRate * Math.pow(1 + monthlyRate, n)) / (Math.pow(1 + monthlyRate, n) - 1);
        calculatedMonthlyRevenue = Math.round(pmt * 100) / 100;
        calculatedTotalInstallment = Math.round((calculatedMonthlyRevenue * installmentPeriod) * 100) / 100;
      }
    }
    
    setValue("monthlyRevenue", calculatedMonthlyRevenue);
    setValue("totalInstallmentPayment", calculatedTotalInstallment);
    
    // TCV(RM) calculation:
    // If Installment Plan: TCV = Total Installment Payment
    // If Upfront Payment: TCV = Outright Purchase Price (for the entire contract duration)
    let calculatedTCV = 0;
    if (decision === "Installment Plan") {
      calculatedTCV = calculatedTotalInstallment;
    } else {
      // For Upfront Payment, TCV is the Outright Purchase Price (which is already calculated based on contract years)
      calculatedTCV = baseOutrightPrice;
    }
    setValue("tcv", calculatedTCV);
  }, [units, costPerUnit, sstRate, years, salesBuffer, decision, installmentPeriod, category, setValue]);

  // Pricer Margin Calculations for the current service
  const outrightPrice = watch("outrightPrice") || 0;
  const totalCost = watch("totalCost") || 0;
  const totalSST = watch("totalSST") || 0;
  const totalInstallmentPayment = watch("totalInstallmentPayment") || 0;
  const totalCostWithSST = totalCost + totalSST;

  const pricerMargin = useMemo(() => {
    const cidbLevyPercent = metadata?.cidbLevy === "Yes" ? parseFloat(metadata.cidbLevyAmount || "0") : 0;
    const stampDutyPercent = metadata?.stampDuty === "Yes" ? parseFloat(metadata.stampDutyAmount || "0") : 0;
    
    let ePerolehanPercent = 0;
    if (metadata?.ePerolehan === "0.8%") ePerolehanPercent = 0.8;
    else if (metadata?.ePerolehan === "0.4%") ePerolehanPercent = 0.4;

    const isInstallment = decision === "Installment Plan";
    const revenue = isInstallment ? totalInstallmentPayment : outrightPrice;

    const cidbLevyAmount = (revenue * cidbLevyPercent) / 100;
    const stampDutyAmount = (revenue * stampDutyPercent) / 100;
    const ePerolehanAmount = (revenue * ePerolehanPercent) / 100;
    
    const rawGrossMarginRM = revenue - totalCostWithSST;
    const grossMarginRM = rawGrossMarginRM;
    const grossMarginPercentage = revenue !== 0 ? (grossMarginRM / revenue) * 100 : 0;
    
    const commissionAmount = (category === "annual" && decision === "Upfront Payment")
      ? outrightPrice * 0.0685
      : (rawGrossMarginRM - (cidbLevyAmount + stampDutyAmount + ePerolehanAmount)) * 0.0685;

    const totalOpexRM = cidbLevyAmount + stampDutyAmount + ePerolehanAmount + commissionAmount;

    const ebitdaMarginRM = grossMarginRM - totalOpexRM;
    const ebitdaMarginPercentage = revenue !== 0 ? (ebitdaMarginRM / revenue) * 100 : 0;

    return {
      cidbLevyAmount,
      stampDutyAmount,
      ePerolehanAmount,
      grossMarginRM,
      grossMarginPercentage,
      commissionAmount,
      totalOpexRM,
      ebitdaMarginRM,
      ebitdaMarginPercentage,
      isInstallment
    };
  }, [outrightPrice, totalCostWithSST, metadata, decision, totalInstallmentPayment, category]);

  const serviceType = watch("serviceType");
  const ebitdaMarginPercentage = pricerMargin.ebitdaMarginPercentage;
  const displayedEbitdaMargin = Math.ceil(ebitdaMarginPercentage * 10) / 10;

  useEffect(() => {
    // Bucket A: Hardware, Software, License — 3-tier. Head of Commercial is
    // the default for the middle band; CEBO isn't independently assignable
    // here — it's already part of the sequential approval chain whenever a
    // service in the order requires CFO.
    const isHardwareSoftwareLicense = ["Hardware", "Software", "License"].includes(serviceType);
    // Bucket B: everything else — full 4-tier.
    const isOtherServices = ["Maintenance", "Installation", "Professional Service", "Consultancy", "Others"].includes(serviceType);

    let level = "";
    if (isHardwareSoftwareLicense && displayedEbitdaMargin >= 15) {
      level = "Head of Sales";
    } else if (isHardwareSoftwareLicense && displayedEbitdaMargin >= 10 && displayedEbitdaMargin < 15) {
      level = "Head of Commercial";
    } else if (isHardwareSoftwareLicense && displayedEbitdaMargin < 10) {
      level = "Finance";
    } else if (isOtherServices && displayedEbitdaMargin >= 25) {
      level = "Head of Sales";
    } else if (isOtherServices && displayedEbitdaMargin >= 20 && displayedEbitdaMargin < 25) {
      level = "Head of Commercial";
    } else if (isOtherServices && displayedEbitdaMargin >= 15 && displayedEbitdaMargin < 20) {
      level = "CEBO";
    } else if (isOtherServices && displayedEbitdaMargin < 15) {
      level = "Finance";
    }

    if (level) {
      setValue("authorityLevel", level);
      if (level === "Finance") {
        setValue("authorityRank", "Rank 1");
      } else if (level === "CEBO") {
        setValue("authorityRank", "Rank 2");
      } else if (level === "Head of Commercial") {
        setValue("authorityRank", "Rank 3");
      } else if (level === "Head of Sales") {
        setValue("authorityRank", "Rank 4");
      }
    }
  }, [serviceType, displayedEbitdaMargin, setValue]);

  return (
    <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>{initialData ? "Edit Service" : "Add New Service"}</DialogTitle>
        <DialogDescription>
          {category === "one-time" ? "Part A: One Time Cost services" : "Part B: Annual Services Cost"}
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 py-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* General Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold border-b pb-1">1. General Info</h3>
            <div className="space-y-2">
              <Label htmlFor="name">Service Name</Label>
              <Input id="name" {...register("name")} placeholder="e.g. Cloud Hosting" />
              {errors.name && <p className="text-xs text-destructive">{errors.name.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="description">Description <span className="text-destructive">*</span></Label>
              <Textarea id="description" {...register("description")} placeholder="Service details..." />
              {errors.description && <p className="text-xs text-destructive">{errors.description.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Service Type <span className="text-destructive">*</span></Label>
              <Select onValueChange={(v) => setValue("serviceType", v)} value={watch("serviceType")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select type" />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.serviceType && <p className="text-xs text-destructive">{errors.serviceType.message}</p>}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="units">No of units <span className="text-destructive">*</span></Label>
                <Input id="units" type="number" {...register("units", { valueAsNumber: true })} />
                {errors.units && <p className="text-xs text-destructive">{errors.units.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="years">No of years <span className="text-destructive">*</span></Label>
                <Input id="years" type="number" {...register("years", { valueAsNumber: true })} />
                {errors.years && <p className="text-xs text-destructive">{errors.years.message}</p>}
              </div>
            </div>
          </div>

          {/* Price to Customer */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold border-b pb-1">2. Price to Customer</h3>
            <div className="space-y-2">
              <Label htmlFor="outrightPrice">Outright Purchase Price (RM)</Label>
              <Input type="hidden" {...register("outrightPrice", { valueAsNumber: true })} />
              <Input 
                id="outrightPrice" 
                type="text" 
                value={(watch("outrightPrice") || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                readOnly 
                className="bg-muted" 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="monthlyRevenue">Monthly Installment Revenue (RM)</Label>
              <Input type="hidden" {...register("monthlyRevenue", { valueAsNumber: true })} />
              <Input 
                id="monthlyRevenue" 
                type="text" 
                value={(watch("monthlyRevenue") || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                readOnly 
                className="bg-muted" 
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="totalInstallmentPayment">Total Installment Payment (RM)</Label>
              <Input type="hidden" {...register("totalInstallmentPayment", { valueAsNumber: true })} />
              <Input 
                id="totalInstallmentPayment" 
                type="text" 
                value={(watch("totalInstallmentPayment") || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 
                readOnly 
                className="bg-muted" 
              />
            </div>
            <Input type="hidden" {...register("tcv", { valueAsNumber: true })} />

            <h3 className="text-sm font-semibold border-b pb-1 pt-2">3. Payment Term</h3>
            <div className="space-y-2">
              <Label>Decision <span className="text-destructive">*</span></Label>
              <Select onValueChange={(v) => setValue("decision", v)} value={watch("decision")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select decision" />
                </SelectTrigger>
                <SelectContent>
                  {DECISIONS.map((d) => (
                    <SelectItem key={d} value={d}>{d}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.decision && <p className="text-xs text-destructive">{errors.decision.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="installmentPeriod">Contract Period (months) <span className="text-destructive">*</span></Label>
              <Input
                id="installmentPeriod"
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 4"
                {...register("installmentPeriod", { valueAsNumber: true })}
              />
              {errors.installmentPeriod && (
                <p className="text-xs text-destructive">{errors.installmentPeriod.message}</p>
              )}
            </div>
          </div>

          {/* Cost From Vendor */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold border-b pb-1">4. Cost From Vendor</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="costPerUnit">Cost/unit (RM) <span className="text-destructive">*</span></Label>
                <Input id="costPerUnit" type="number" step="0.01" {...register("costPerUnit", { valueAsNumber: true })} />
                {errors.costPerUnit && <p className="text-xs text-destructive">{errors.costPerUnit.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalCost">Total cost (RM)</Label>
                <Input id="totalCost" type="number" step="0.01" {...register("totalCost", { valueAsNumber: true })} readOnly className="bg-muted" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="sstRate">SST Rate (%) <span className="text-destructive">*</span></Label>
                <Input id="sstRate" type="number" step="0.1" {...register("sstRate", { valueAsNumber: true })} />
                {errors.sstRate && <p className="text-xs text-destructive">{errors.sstRate.message}</p>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="totalSST">Total SST (RM)</Label>
                <Input id="totalSST" type="number" step="0.01" {...register("totalSST", { valueAsNumber: true })} readOnly className="bg-muted" />
              </div>
            </div>
          </div>

          {/* Governance & Buffer */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold border-b pb-1">5. Governance & Buffer</h3>
            <div className="space-y-2">
              <Label htmlFor="salesBuffer">Sales Buffer % <span className="text-destructive">*</span></Label>
              <Input id="salesBuffer" type="number" step="0.01" {...register("salesBuffer", { valueAsNumber: true })} />
              {errors.salesBuffer && <p className="text-xs text-destructive">{errors.salesBuffer.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Entity <span className="text-destructive">*</span></Label>
              <Select onValueChange={(v) => setValue("entity", v)} value={watch("entity")}>
                <SelectTrigger>
                  <SelectValue placeholder="Select entity" />
                </SelectTrigger>
                <SelectContent>
                  {ENTITIES.map((e) => (
                    <SelectItem key={e} value={e}>{e}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.entity && <p className="text-xs text-destructive">{errors.entity.message}</p>}
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="authorityLevel">Level of authority</Label>
                <Input id="authorityLevel" {...register("authorityLevel")} readOnly className="bg-muted" />
              </div>
              {/* Level of authority Rank — hidden from view, still auto-set by the
                  useEffect below based on Service Type + Gross Margin. Flip
                  {false && back to true to restore the field for manual entry. */}
              {false && (
              <div className="space-y-2">
                <Label htmlFor="authorityRank">Level of authority Rank <span className="text-destructive">*</span></Label>
                <Input id="authorityRank" {...register("authorityRank")} placeholder="e.g. Rank 1" />
                {errors.authorityRank && <p className="text-xs text-destructive">{errors.authorityRank.message}</p>}
              </div>
              )}
            </div>
          </div>

        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
          <Button type="submit">{initialData ? "Update Service" : "Add Service"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
