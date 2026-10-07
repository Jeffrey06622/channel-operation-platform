-- Replace the single-column unique constraint on groups.name with a composite
-- unique constraint on (class_label, name) so that group names only need to be
-- unique within a class, not globally. Different classes can share names.

ALTER TABLE groups DROP CONSTRAINT groups_name_key;

CREATE UNIQUE INDEX groups_class_name_key
  ON public.groups (class_label, name);
