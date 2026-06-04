"use client";

import { useEffect, useState } from "react";
import { Wallet, ArrowUpRight, ArrowDownLeft, Plus, History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatPrice } from "@/utils/format";
import { cn } from "@/utils/cn";

export function WalletCard() {
  const [data, setData] = useState<{ balance: number; transactions: { id: string; type: string; reference?: string; amount: number }[] } | null>(null);
  const [loading, setLoading] = useState(true);

  async function fetchWallet() {
    try {
      const res = await fetch("/api/wallet");
      const json = await res.json();
      if (json.ok) {
        setData(json.data);
      }
    } catch (err) {
      console.error("Failed to load wallet", err);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchWallet();
  }, []);

  if (loading) {
    return (
      <Card className="animate-pulse bg-white/5 border-white/10 h-[240px]">
        <CardContent className="h-full" />
      </Card>
    );
  }

  return (
    <Card className="border-trade-amber/20 bg-trade-amber/[0.02] overflow-hidden">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div className="flex items-center gap-2">
          <Wallet className="h-5 w-5 text-trade-amber" />
          <CardTitle className="text-sm font-medium">Virtual Wallet</CardTitle>
        </div>
        <Button 
          variant="ghost" 
          size="icon" 
          className="h-8 w-8 text-slate-400 hover:text-white"
          onClick={fetchWallet}
        >
          <History className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mt-2">
          <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Total Balance</p>
          <h2 className="text-3xl font-bold text-white mt-1">
            {formatPrice(data?.balance || 0)}
          </h2>
        </div>

        <div className="mt-6 flex gap-3">
          <Button className="flex-1 bg-trade-amber text-black hover:bg-trade-amber/90 font-bold h-10">
            <Plus className="h-4 w-4 mr-2" />
            Deposit
          </Button>
          <Button variant="outline" className="flex-1 border-white/10 text-white hover:bg-white/5 h-10">
            Withdraw
          </Button>
        </div>

        <div className="mt-6 space-y-3">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Recent Activity</p>
          {data?.transactions.slice(0, 2).map((tx) => (
            <div key={tx.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                {tx.type.includes("BUY") ? (
                  <ArrowUpRight className="h-3 w-3 text-trade-red" />
                ) : (
                  <ArrowDownLeft className="h-3 w-3 text-trade-green" />
                )}
                <span className="text-slate-300">{tx.reference || tx.type}</span>
              </div>
              <span className={cn(
                "font-medium",
                tx.type.includes("BUY") ? "text-trade-red" : "text-trade-green"
              )}>
                {tx.type.includes("BUY") ? "-" : "+"}{formatPrice(tx.amount)}
              </span>
            </div>
          ))}
          {(!data?.transactions || data.transactions.length === 0) && (
            <p className="text-[10px] text-slate-600 italic">No recent transactions</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
