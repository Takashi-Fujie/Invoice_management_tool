export type Row = {
  id: string;
  description: string;
  amount: number | null;
  rewardType: "per_item" | "hourly" | "travel" | "expense" | "adjustment";
  hours: string;
  rate: string;
  manualAmount: number | null;
  priceMode: string;
  feePriceMode: string;
  travelPriceMode: string;
  withholdingEnabled: boolean;
  discountEnabled: boolean;
  discountRate: string;
};
export type Company = {
  id: string;
  name: string;
  revision: number;
  rows: Row[];
  withholdingAmount: number | null;
  invoiced: boolean;
  paid: boolean;
  visible: boolean;
};
export type Data = { companies: Company[] };
