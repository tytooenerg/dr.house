import sys
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest

from lastro_sdk import LastroApiError, LastroClient, LastroNetworkError
from conftest import register_and_generate_key


def unique() -> str:
    return f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"


def internal_url(base_url: str) -> str:
    return base_url.replace("/api/v1", "")


def test_emits_a_duplicata_fetches_it_back_and_lists_marketplace(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)

    emitted = client.emitir_duplicata(sacado="Grupo Atlas Varejo", cnpj="12.345.678/0001-90", valor="10.000,00", vencimento="2026-12-01")
    assert emitted["duplicataId"]
    assert emitted["mode"] == "test"

    fetched = client.get_duplicata(emitted["duplicataId"])
    assert fetched["id"] == emitted["duplicataId"]
    assert fetched["sacado"] == "Grupo Atlas Varejo"

    marketplace = client.list_marketplace()
    assert isinstance(marketplace["offers"], list)


def test_idempotency_replays_the_original_result(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)
    idempotency_key = f"py-sdk-test-{unique()}"
    kwargs = dict(sacado="Distribuidora Bom Preço", valor="5.000,00", vencimento="2026-11-01")

    first = client.emitir_duplicata(**kwargs, idempotency_key=idempotency_key)
    second = client.emitir_duplicata(**kwargs, idempotency_key=idempotency_key)
    assert second["duplicataId"] == first["duplicataId"]


def test_raises_lastro_api_error_on_role_violation(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "investidor", unique())
    client = LastroClient(api_key, base_url=base_url)
    with pytest.raises(LastroApiError) as exc_info:
        client.emitir_duplicata(sacado="X", valor="1.000", vencimento="2026-12-01")
    assert exc_info.value.status == 403
    assert exc_info.value.error == "forbidden"


def test_raises_lastro_api_error_401_on_invalid_key(base_url):
    client = LastroClient("lastro_live_not_a_real_key", base_url=base_url)
    with pytest.raises(LastroApiError) as exc_info:
        client.list_marketplace()
    assert exc_info.value.status == 401


def test_scores_a_cnpj_and_reflects_a_reported_signal(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)
    cnpj = "12.345.678/0001-90"

    before = client.get_score(cnpj)
    assert isinstance(before["score"], (int, float))

    after = client.report_signal(cnpj, tipo="pagamento_pontual", nota="Python SDK test signal")
    assert isinstance(after["score"], (int, float))


def test_screens_a_name_against_the_real_pld_pipeline(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)
    result = client.screen_pld(nome="Pessoa Comum Sem Restrições")
    assert result["nome"] == "Pessoa Comum Sem Restrições"
    assert isinstance(result["flagged"], bool)


def test_lists_aceites_structurally(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)
    result = client.list_aceites()
    assert isinstance(result["aceites"], list)


def test_rejects_an_empty_api_key_before_any_network_call():
    with pytest.raises(ValueError):
        LastroClient("")


def test_raises_lastro_network_error_when_unreachable():
    client = LastroClient("lastro_test_whatever", base_url="http://127.0.0.1:1/v1", timeout=2)
    with pytest.raises(LastroNetworkError):
        client.list_marketplace()
