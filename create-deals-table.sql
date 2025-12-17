-- Create RENT_deals table
CREATE TABLE IF NOT EXISTS "RENT_deals" (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  address TEXT NOT NULL,
  seller_name TEXT,
  seller_phone TEXT,
  sell_price NUMERIC(12, 2) NOT NULL,
  date_purchased DATE NOT NULL,
  "Soteris_$" NUMERIC(12, 2),
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create index on date_purchased for faster queries
CREATE INDEX IF NOT EXISTS idx_deals_date_purchased ON "RENT_deals"(date_purchased);

-- Create index on address for search
CREATE INDEX IF NOT EXISTS idx_deals_address ON "RENT_deals"(address);

-- Enable Row Level Security (RLS)
ALTER TABLE "RENT_deals" ENABLE ROW LEVEL SECURITY;

-- Create policy to allow authenticated users to read
CREATE POLICY "Allow authenticated users to read deals"
  ON "RENT_deals"
  FOR SELECT
  TO authenticated
  USING (true);

-- Create policy to allow authenticated users to insert
CREATE POLICY "Allow authenticated users to insert deals"
  ON "RENT_deals"
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Create policy to allow authenticated users to update
CREATE POLICY "Allow authenticated users to update deals"
  ON "RENT_deals"
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- Create policy to allow authenticated users to delete
CREATE POLICY "Allow authenticated users to delete deals"
  ON "RENT_deals"
  FOR DELETE
  TO authenticated
  USING (true);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_deals_updated_at
  BEFORE UPDATE ON "RENT_deals"
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

