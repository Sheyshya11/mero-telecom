ALTER TABLE "InternetPlan"
ADD COLUMN "highlights" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "InternetPlan"
SET "highlights" = CASE
  WHEN "downloadMbps" <= 25 THEN ARRAY['Web browsing and email', 'Social media', 'Light streaming']::TEXT[]
  WHEN "downloadMbps" <= 50 THEN ARRAY['Multiple devices at once', 'HD streaming', 'Working from home']::TEXT[]
  WHEN "downloadMbps" <= 100 THEN ARRAY['4K streaming', 'Online gaming', 'Larger households']::TEXT[]
  WHEN "downloadMbps" <= 250 THEN ARRAY['Heavy streaming', 'Fast game downloads', 'Power users and creators']::TEXT[]
  ELSE ARRAY['Maximum home performance', 'Many devices at once', 'Ultra-fast downloads']::TEXT[]
END;
