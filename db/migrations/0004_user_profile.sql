-- Every account carries a first name, last name and phone (international
-- form), so verification codes can go to either channel later.
alter table users add column first_name text, add column last_name text, add column phone text;
