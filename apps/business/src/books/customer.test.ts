import { describe, expect, it } from "vitest";
import { createBooks } from "@pnw/ledger";
import { companyFromJson, companyToJson, emptyCompany } from "./company";
import { emptyCustomer, setCustomerName, validateCustomer } from "./customer";
import { redirectFor, HOME } from "@/shell/AppShell";

const NAME = { name: "rowan", nameHash: "1234567890", registeredAt: "2026-10-26T00:00:00.000Z" };

describe("a customer's side", () => {
  it("round-trips through the vault document with its role", () => {
    const c = { ...emptyCompany(createBooks({ businessName: "Rowan Ash", fiscalYearStartMonth: 1 })), role: "customer" as const, customer: setCustomerName(emptyCustomer(), NAME) };
    const back = companyFromJson(companyToJson(c));
    expect(back.role).toBe("customer");
    expect(back.customer).toEqual({ version: 1, name: NAME });
  });

  it("refuses a damaged section", () => {
    expect(() => validateCustomer(null)).toThrow();
    expect(() => validateCustomer({ version: 2 })).toThrow(/newer version/);
    expect(() => validateCustomer({ version: 1, name: { ...NAME, nameHash: "12field" } })).toThrow(/name is damaged/);
    expect(() => validateCustomer({ version: 1, name: { ...NAME, name: "Rowan Ash" } })).toThrow(/name is damaged/);
    expect(validateCustomer({ version: 1, extra: "dropped" })).toEqual({ version: 1 });
  });
});

describe("where a customer's account lives", () => {
  it("keeps a customer in their portal, and every other account out of it", () => {
    expect(HOME.customer).toBe("/customer");
    expect(redirectFor("customer", "/customer")).toBeNull();
    expect(redirectFor("customer", "/customer/bills")).toBeNull();
    expect(redirectFor("customer", "/")).toBe("/customer");
    expect(redirectFor("customer", "/payroll")).toBe("/customer");
    expect(redirectFor("customer", "/work")).toBe("/customer");
    expect(redirectFor("customer", "/settings")).toBeNull();
    expect(redirectFor("customer", "/board")).toBeNull(); // public pages stay open
    expect(redirectFor("business", "/customer")).toBe("/");
    expect(redirectFor("worker", "/customer")).toBe("/work");
  });
});
