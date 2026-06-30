"use server";

// Admin mutations. Each re-verifies admin (never trust the page guard alone),
// writes the change, and revalidates the affected pages. Invoked from
// <form action={...}> in the admin user detail page.

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type UserRole } from "@/db/schema";
import { requireAdmin } from "@/lib/dal";

function revalidateUser(userId: string) {
  revalidatePath(`/admin/users/${userId}`);
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

export async function setApiAccess(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const apiAccess = String(formData.get("apiAccess") ?? "") === "true";
  if (!userId) return;
  await db.update(users).set({ apiAccess }).where(eq(users.id, userId));
  revalidateUser(userId);
}

export async function setSuspended(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const suspended = String(formData.get("suspended") ?? "") === "true";
  if (!userId) return;
  await db.update(users).set({ suspended }).where(eq(users.id, userId));
  revalidateUser(userId);
}

export async function setRole(formData: FormData) {
  const admin = await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const role = String(formData.get("role") ?? "") as UserRole;
  if (!userId || (role !== "user" && role !== "admin")) return;
  // Guard: don't let an admin strip their own admin role (lockout safety).
  if (userId === admin.id && role !== "admin") return;
  await db.update(users).set({ role }).where(eq(users.id, userId));
  revalidateUser(userId);
}

export async function setFeatureFlag(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  const enabled = String(formData.get("enabled") ?? "") === "true";
  if (!userId || !key) return;
  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) return;
  const flags = { ...(target.featureFlags ?? {}), [key]: enabled };
  await db.update(users).set({ featureFlags: flags }).where(eq(users.id, userId));
  revalidateUser(userId);
}

export async function removeFeatureFlag(formData: FormData) {
  await requireAdmin();
  const userId = String(formData.get("userId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  if (!userId || !key) return;
  const target = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!target) return;
  const flags = { ...(target.featureFlags ?? {}) };
  delete flags[key];
  await db.update(users).set({ featureFlags: flags }).where(eq(users.id, userId));
  revalidateUser(userId);
}
