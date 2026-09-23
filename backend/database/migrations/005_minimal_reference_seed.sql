INSERT INTO countries(code,name) VALUES
  ('IN','India'),('US','United States'),('GB','United Kingdom'),('AE','United Arab Emirates'),
  ('DE','Germany'),('CN','China'),('VN','Vietnam'),('BD','Bangladesh')
ON CONFLICT (code) DO UPDATE SET name=EXCLUDED.name;

