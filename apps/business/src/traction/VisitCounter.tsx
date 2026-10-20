"use client";

import { apiUrl } from "../api_base";
// One count per browser session (app/api/traction/counts.ts): a visit, and
// whether this device has ever been counted before. The device keeps that
// answer itself; nothing about it is sent but yes or no. No cookies.

import { useEffect } from "react";

const SESSION_KEY = "hewn-visit-counted";
const DEVICE_KEY = "hewn-visitor-counted";

export function VisitCounter() {
  useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
      sessionStorage.setItem(SESSION_KEY, "1");
      const first = !localStorage.getItem(DEVICE_KEY);
      if (first) localStorage.setItem(DEVICE_KEY, "1");
      void fetch(apiUrl("/api/count"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ first }), credentials: "same-origin", keepalive: true }).catch(() => {});
    } catch {
      // storage blocked (a private window): count nothing rather than guess
    }
  }, []);
  return null;
}
