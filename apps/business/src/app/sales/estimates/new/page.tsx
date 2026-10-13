"use client";

import { Suspense } from "react";
import { DocumentEditor } from "../../DocumentForm";

export default function NewEstimatePage() {
  return (
    <Suspense>
      <DocumentEditor kind="estimate" />
    </Suspense>
  );
}
