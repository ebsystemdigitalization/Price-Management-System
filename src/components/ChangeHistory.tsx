import { Order } from "../types";
import { diffOrderVersions, formatDiffValue, OrderDiff } from "../utils/orderDiff";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, Plus, Minus, Pencil } from "lucide-react";

interface ChangeHistoryProps {
  current: Order;
  previous: Order | undefined;
  compact?: boolean; // compact = for MainPage inline; full = OrderDetails panel
}

/**
 * Displays what changed between an order version and its predecessor.
 * Pure presentation over computed diffs — no calculation logic here.
 */
export default function ChangeHistory({ current, previous, compact = false }: ChangeHistoryProps) {
  if (!previous) {
    return (
      <div className="text-xs text-muted-foreground italic">
        This is the first version (v{current.version || 1}) — no previous version to compare.
      </div>
    );
  }

  const diff: OrderDiff = diffOrderVersions(previous, current);

  if (!diff.hasChanges) {
    return (
      <div className="text-xs text-muted-foreground italic">
        No field or service differences detected from v{previous.version || 1}.
      </div>
    );
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-4"}>
      <div className="text-xs text-muted-foreground">
        Comparing <span className="font-semibold">v{previous.version || 1}</span>
        <ArrowRight className="inline h-3 w-3 mx-1" />
        <span className="font-semibold">v{current.version || 1}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        Changed by <span className="font-semibold text-foreground">{current.createdBy || "Unknown"}</span>
        {" "}on{" "}
        <span className="font-semibold text-foreground">{new Date(current.createdAt).toLocaleString()}</span>
      </div>

      {/* Order-level field changes */}
      {diff.fieldChanges.length > 0 && (
        <div className="space-y-1.5">
          {!compact && (
            <h5 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Order Field Changes ({diff.fieldChanges.length})
            </h5>
          )}
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-3 py-1.5 font-semibold">Field</th>
                  <th className="text-left px-3 py-1.5 font-semibold">Previous</th>
                  <th className="text-left px-3 py-1.5 font-semibold">New</th>
                </tr>
              </thead>
              <tbody>
                {diff.fieldChanges.map((c) => (
                  <tr key={c.key} className="border-t">
                    <td className="px-3 py-1.5 font-medium">{c.field}</td>
                    <td className="px-3 py-1.5 text-rose-600 line-through opacity-70">
                      {formatDiffValue(c.before)}
                    </td>
                    <td className="px-3 py-1.5 text-emerald-600 font-semibold">
                      {formatDiffValue(c.after)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Service-level changes */}
      {diff.serviceChanges.length > 0 && (
        <div className="space-y-1.5">
          {!compact && (
            <h5 className="text-[11px] font-bold text-muted-foreground uppercase tracking-wider">
              Service Changes ({diff.serviceChanges.length})
            </h5>
          )}
          <div className="space-y-2">
            {diff.serviceChanges.map((sc) => {
              if (sc.type === "added") {
                return (
                  <div key={sc.serviceId} className="flex items-center gap-2 text-xs p-2 rounded border bg-emerald-50/40 border-emerald-200">
                    <Badge className="bg-emerald-100 text-emerald-800 hover:bg-emerald-100 gap-1">
                      <Plus className="h-3 w-3" /> Added
                    </Badge>
                    <span className="font-medium">{sc.serviceName}</span>
                  </div>
                );
              }
              if (sc.type === "removed") {
                return (
                  <div key={sc.serviceId} className="flex items-center gap-2 text-xs p-2 rounded border bg-rose-50/40 border-rose-200">
                    <Badge className="bg-rose-100 text-rose-800 hover:bg-rose-100 gap-1">
                      <Minus className="h-3 w-3" /> Removed
                    </Badge>
                    <span className="font-medium line-through opacity-70">{sc.serviceName}</span>
                  </div>
                );
              }
              // modified
              return (
                <div key={sc.serviceId} className="text-xs p-2 rounded border bg-amber-50/40 border-amber-200 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100 gap-1">
                      <Pencil className="h-3 w-3" /> Modified
                    </Badge>
                    <span className="font-medium">{sc.serviceName}</span>
                  </div>
                  {sc.changes && sc.changes.length > 0 && (
                    <div className="pl-2 border-l-2 border-amber-300 space-y-0.5">
                      {sc.changes.map((c) => (
                        <div key={c.key} className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-muted-foreground">{c.field}:</span>
                          <span className="text-rose-600 line-through opacity-70">{formatDiffValue(c.before)}</span>
                          <ArrowRight className="h-3 w-3 text-muted-foreground" />
                          <span className="text-emerald-600 font-semibold">{formatDiffValue(c.after)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}