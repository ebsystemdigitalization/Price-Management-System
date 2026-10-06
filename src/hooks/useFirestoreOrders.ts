import { useEffect, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { functions } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { Order } from "../types";

/**
 * Orders from the server-side listOrders Cloud Function.
 * All role-based filtering and field-stripping now happens on the server.
 * Polls every few seconds to keep data current (replaces the old onSnapshot
 * live listener, which required direct client-to-Firestore access).
 */
const POLL_INTERVAL_MS = 4000;

export function useFirestoreOrders() {
  const { currentUser } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentUser) {
      setOrders([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const listOrdersFn = httpsCallable(functions, "listOrders");

    const fetchOrders = async () => {
      try {
        const result = await listOrdersFn();
        if (cancelled) return;
        const data = result.data as { orders: Order[] };
        setOrders(data.orders || []);
      } catch (err) {
        if (!cancelled) console.error("listOrders error:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    // Fetch immediately, then poll.
    fetchOrders();
    const intervalId = setInterval(fetchOrders, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [currentUser]);

  return { orders, loading };
}