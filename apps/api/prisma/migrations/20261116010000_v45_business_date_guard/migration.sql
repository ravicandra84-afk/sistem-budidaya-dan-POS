-- Reject future entry dates using the locked Asia/Jakarta business calendar.
CREATE FUNCTION "enforce_entry_date_business_timezone"() RETURNS trigger AS $$
BEGIN
    IF NEW."entry_date" > (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Jakarta')::DATE THEN
        RAISE EXCEPTION 'entry_date cannot be in the future in Asia/Jakarta'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- The trigger keeps direct database inserts from bypassing the V4.5 date boundary.
CREATE TRIGGER "incoming_fish_entry_date_guard"
BEFORE INSERT ON "incoming_fish"
FOR EACH ROW EXECUTE FUNCTION "enforce_entry_date_business_timezone"();

-- Runtime cannot replace or remove the boundary guard function.
REVOKE ALL PRIVILEGES ON FUNCTION "enforce_entry_date_business_timezone"() FROM PUBLIC;