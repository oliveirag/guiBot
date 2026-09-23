-- AlterTable
ALTER TABLE "DevEvent" ADD COLUMN "stream" TEXT;

-- CreateIndex
CREATE INDEX "DevEvent_source_key_stream_idx" ON "DevEvent"("source", "key", "stream");
