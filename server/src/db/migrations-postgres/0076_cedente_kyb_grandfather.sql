UPDATE users SET kyb_status = 'approved', kyb_done = 1 WHERE role = 'cedente' AND kyb_status != 'approved';
