-- 실패 사유 기록: 폴백이 왜 일어났는지(timeout / rate_limited / contract 등)를 남긴다.
-- 사유가 없으면 "폴백 N건"만 쌓이고 무엇을 고쳐야 하는지는 사람이 손으로 찾아야 한다.
ALTER TABLE ai_calls ADD COLUMN reason TEXT;
