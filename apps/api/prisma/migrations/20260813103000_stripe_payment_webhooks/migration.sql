ALTER TABLE "Payment"
ADD COLUMN "providerSessionId" VARCHAR(255);

CREATE UNIQUE INDEX "Payment_providerSessionId_key"
ON "Payment"("providerSessionId");

CREATE TABLE "PaymentWebhookEvent" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "providerEventId" VARCHAR(255) NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "paymentId" UUID,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentWebhookEvent_providerEventId_key"
ON "PaymentWebhookEvent"("providerEventId");

CREATE INDEX "PaymentWebhookEvent_paymentId_idx"
ON "PaymentWebhookEvent"("paymentId");

ALTER TABLE "PaymentWebhookEvent"
ADD CONSTRAINT "PaymentWebhookEvent_paymentId_fkey"
FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
