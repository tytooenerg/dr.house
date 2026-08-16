ALTER TABLE addon_charges DROP CONSTRAINT addon_charges_kind_check;
ALTER TABLE addon_charges ADD CONSTRAINT addon_charges_kind_check CHECK (kind IN ('api_overage', 'score_api', 'pld_screening_api', 'registro_api', 'whitelabel_plus', 'institutional_reporting'));
