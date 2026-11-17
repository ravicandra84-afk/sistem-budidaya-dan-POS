-- Prisma inserts may explicitly return database-generated identifiers and timestamps; table INSERT remains append-only.
GRANT INSERT ON TABLE "fish_sales" TO pfi_app_runtime;
GRANT INSERT ON TABLE "fish_sale_voids" TO pfi_app_runtime;