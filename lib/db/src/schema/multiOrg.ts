import {
  pgTable, serial, varchar, boolean, text, timestamp, integer,
} from "drizzle-orm/pg-core";

/**
 * Organizations — top-level tenant entities.
 * Each deployment can serve one or many organizations (multi-tenant).
 * orgType drives which modules, ranks, and policies are available.
 */
export const organizationsTable = pgTable("organizations", {
  id: serial("id").primaryKey(),
  // "company" | "ministry" | "agency" | "command" | "military_unit" | "university" | "hospital"
  orgType: varchar("org_type", { length: 30 }).notNull().default("company"),
  // Short machine-readable code, e.g. "ARAMCO", "MOI", "RSLF-3"
  orgCode: varchar("org_code", { length: 30 }).notNull().unique(),
  nameEn: varchar("name_en", { length: 200 }).notNull(),
  nameAr: varchar("name_ar", { length: 200 }).notNull(),
  shortNameEn: varchar("short_name_en", { length: 60 }),
  shortNameAr: varchar("short_name_ar", { length: 60 }),
  // Legal registration number / CR / government registration
  registrationNumber: varchar("registration_number", { length: 60 }),
  // "active" | "onboarding" | "suspended" | "archived"
  status: varchar("status", { length: 20 }).notNull().default("onboarding"),
  // Parent org for sub-commands / subsidiaries
  parentOrgId: integer("parent_org_id"),
  // Primary contact details
  primaryContactNameEn: varchar("primary_contact_name_en", { length: 120 }),
  primaryContactNameAr: varchar("primary_contact_name_ar", { length: 120 }),
  primaryContactEmail: varchar("primary_contact_email", { length: 200 }),
  primaryContactPhone: varchar("primary_contact_phone", { length: 30 }),
  headquartersCity: varchar("headquarters_city", { length: 80 }),
  countryCode: varchar("country_code", { length: 3 }).notNull().default("SA"),
  isDefault: boolean("is_default").notNull().default(false),
  activatedAt: timestamp("activated_at"),
  createdByUserId: integer("created_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type Organization = typeof organizationsTable.$inferSelect;

/**
 * Organization branding — white-label configuration per org.
 * Controls the look/feel of that org's web and mobile clients.
 */
export const organizationBrandingTable = pgTable("organization_branding", {
  id: serial("id").primaryKey(),
  orgId: integer("org_id").notNull().unique(),
  // Display name overrides (shown in UI header, emails, etc.)
  displayNameEn: varchar("display_name_en", { length: 200 }),
  displayNameAr: varchar("display_name_ar", { length: 200 }),
  taglineEn: varchar("tagline_en", { length: 300 }),
  taglineAr: varchar("tagline_ar", { length: 300 }),
  // Brand colors (hex)
  primaryColor: varchar("primary_color", { length: 9 }).notNull().default("#D97706"),
  accentColor: varchar("accent_color", { length: 9 }),
  // "dark" | "light" | "high_contrast"
  defaultTheme: varchar("default_theme", { length: 20 }).notNull().default("dark"),
  // Logo/favicon URLs (local paths or base64 data URIs — no external CDN for air-gap)
  logoUrl: varchar("logo_url", { length: 500 }),
  faviconUrl: varchar("favicon_url", { length: 500 }),
  // Custom footer text in emails/reports
  footerTextEn: text("footer_text_en"),
  footerTextAr: text("footer_text_ar"),
  // Custom login page message
  loginMessageEn: text("login_message_en"),
  loginMessageAr: text("login_message_ar"),
  // Custom CSS overrides (sanitized)
  customCssSnippet: text("custom_css_snippet"),
  isActive: boolean("is_active").notNull().default(true),
  updatedByUserId: integer("updated_by_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type OrganizationBranding = typeof organizationBrandingTable.$inferSelect;
