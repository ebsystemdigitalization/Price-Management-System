import { Service, ServiceCategory } from "@/src/types";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Search, Plus } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface ServiceListProps {
  category: ServiceCategory;
  services: Service[];
  onEdit: (service: Service) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
}

export function ServiceList({ category, services, onEdit, onDelete, onAdd }: ServiceListProps) {
  const [search, setSearch] = useState("");

  const filteredServices = services.filter((s) =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.serviceType.toLowerCase().includes(search.toLowerCase()) ||
    s.entity.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button onClick={onAdd} className="w-full sm:w-auto">
          <Plus className="mr-2 h-4 w-4" /> Add Service
        </Button>
      </div>

      <div className="rounded-md border bg-card overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-center">No</TableHead>
              <TableHead className="text-center">Services Name</TableHead>
              <TableHead className="text-center">Description</TableHead>
              <TableHead className="text-center">Service Types</TableHead>
              <TableHead className="text-center">No of units</TableHead>
              <TableHead className="text-center">No of years</TableHead>
              <TableHead className="text-center">Outright Purchase Price</TableHead>
              <TableHead className="text-center">Monthly Installment Revenue</TableHead>
              <TableHead className="text-center">Decision</TableHead>
              <TableHead className="text-center">Installment contract period (months)</TableHead>
              <TableHead className="text-center">Cost/unit</TableHead>
              <TableHead className="text-center">Total cost</TableHead>
              <TableHead className="text-center">Total SST (RM)</TableHead>
              <TableHead className="text-center">Sales Buffer %</TableHead>
              <TableHead className="text-center">Entity</TableHead>
              <TableHead className="text-center">Level of authority</TableHead>
              <TableHead className="text-center">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <AnimatePresence mode="popLayout">
              {filteredServices.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={17} className="h-24 text-center text-muted-foreground">
                    No services found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredServices.map((service, index) => (
                  <motion.tr
                    key={service.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    layout
                    className="border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted"
                  >
                    <TableCell className="text-center text-muted-foreground">{index + 1}</TableCell>
                    <TableCell className="text-center font-medium">{service.name}</TableCell>
                    <TableCell className="text-center max-w-[200px] truncate" title={service.description}>
                      {service.description}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{service.serviceType}</Badge>
                    </TableCell>
                    <TableCell className="text-center">{service.units}</TableCell>
                    <TableCell className="text-center">{service.years}</TableCell>
                    <TableCell className="text-center">
                      {service.outrightPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">
                      {service.monthlyRevenue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge variant={service.decision === "Approved" ? "default" : service.decision === "Rejected" ? "destructive" : "outline"}>
                        {service.decision}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center">{service.installmentPeriod}</TableCell>
                    <TableCell className="text-center">
                      {service.costPerUnit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">
                      {service.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">
                      {service.totalSST.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </TableCell>
                    <TableCell className="text-center">{service.salesBuffer}%</TableCell>
                    <TableCell className="text-center">{service.entity}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="outline" className="font-normal">{service.authorityLevel}</Badge>
                    </TableCell>
                    <TableCell className="text-center">
                      <div className="flex justify-center gap-2">
                        <Button variant="ghost" size="icon" onClick={() => onEdit(service)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => onDelete(service.id)} className="text-destructive hover:text-destructive">
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </motion.tr>
                ))
              )}
            </AnimatePresence>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
