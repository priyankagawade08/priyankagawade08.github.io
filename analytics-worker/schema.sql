CREATE TABLE IF NOT EXISTS aggregate_visits (
  day TEXT NOT NULL,
  dimension TEXT NOT NULL CHECK (dimension IN ('total', 'country', 'city', 'network')),
  label TEXT NOT NULL,
  context TEXT NOT NULL DEFAULT '',
  visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0),
  PRIMARY KEY (day, dimension, label, context)
);

CREATE TABLE IF NOT EXISTS network_location_visits (
  day TEXT NOT NULL,
  organization TEXT NOT NULL,
  asn TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  visits INTEGER NOT NULL DEFAULT 0 CHECK (visits >= 0),
  PRIMARY KEY (day, organization, asn, city, country)
);

CREATE INDEX IF NOT EXISTS network_location_visits_day
  ON network_location_visits (day);

PRAGMA optimize;
