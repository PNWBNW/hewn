"use client";

import { Suspense } from "react";
import { DocumentEditor } from "../../DocumentForm";

export default function NewInvoicePage() {
  return (
    <Suspense>
      <DocumentEditor kind="invoice" />
    </Suspense>
  );
}
