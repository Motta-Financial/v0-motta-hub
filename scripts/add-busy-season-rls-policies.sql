-- Add RLS policies for busy_season_work_items table
-- Allow all authenticated users to read, insert, update, and delete

-- Policy for SELECT
CREATE POLICY "Allow authenticated to read busy_season_work_items" 
ON public.busy_season_work_items 
FOR SELECT 
TO authenticated 
USING (true);

-- Policy for INSERT
CREATE POLICY "Allow authenticated to insert busy_season_work_items" 
ON public.busy_season_work_items 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Policy for UPDATE
CREATE POLICY "Allow authenticated to update busy_season_work_items" 
ON public.busy_season_work_items 
FOR UPDATE 
TO authenticated 
USING (true);

-- Policy for DELETE
CREATE POLICY "Allow authenticated to delete busy_season_work_items" 
ON public.busy_season_work_items 
FOR DELETE 
TO authenticated 
USING (true);

-- Also add policies for busy_season_assignment_history table
CREATE POLICY "Allow authenticated to read busy_season_assignment_history" 
ON public.busy_season_assignment_history 
FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Allow authenticated to insert busy_season_assignment_history" 
ON public.busy_season_assignment_history 
FOR INSERT 
TO authenticated 
WITH CHECK (true);

CREATE POLICY "Allow authenticated to update busy_season_assignment_history" 
ON public.busy_season_assignment_history 
FOR UPDATE 
TO authenticated 
USING (true);

CREATE POLICY "Allow authenticated to delete busy_season_assignment_history" 
ON public.busy_season_assignment_history 
FOR DELETE 
TO authenticated 
USING (true);
