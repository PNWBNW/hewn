"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@pnw/ui/tabs";
import { PageHeader } from "@/shell/SectionView";
import { Form1099Tab, PayrollTaxTab } from "./OtherTaxTabs";
import { SalesTaxTab } from "./SalesTaxTab";

export default function TaxesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Taxes" summary="Sales tax and payroll tax you've collected and owe. You file; the numbers stay straight here." />
      <Tabs defaultValue="sales-tax" className="flex flex-col gap-4">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList className="h-auto sm:h-9">
            <TabsTrigger value="sales-tax" className="min-h-11 whitespace-nowrap sm:min-h-7">Sales tax</TabsTrigger>
            <TabsTrigger value="payroll-tax" className="min-h-11 whitespace-nowrap sm:min-h-7">Payroll tax</TabsTrigger>
            <TabsTrigger value="1099" className="min-h-11 sm:min-h-7">1099s</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="sales-tax">
          <SalesTaxTab />
        </TabsContent>
        <TabsContent value="payroll-tax">
          <PayrollTaxTab />
        </TabsContent>
        <TabsContent value="1099">
          <Form1099Tab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
