ALTER TABLE uploads ADD COLUMN duplicata_id TEXT REFERENCES duplicatas(id);
