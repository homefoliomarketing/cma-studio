-- Seed presets + company TEXT branding (logo pushed separately via storage).
update public.org_settings set
  presets = '{"bedroomAbove": 7000, "bedroomBelow": 4000, "fullBath": 4000, "halfBath": 2000, "noGarage": 10000, "garageSpace": 5000, "finishedBasement": 15000, "centralAir": 4000, "conditionPerLevel": 10000, "heating": {"Gas Forced Air": 15000, "Propane Forced Air": 13000, "Electric Baseboard": 0, "Space Heater": 0}}'::jsonb,
  company_branding = '{"companyName": "CENTURY 21", "tagline": "COMPARATIVE MARKET ANALYSIS", "primary": "#252526", "accent": "#beaf87"}'::jsonb,
  updated_at = now()
where id = 1;
