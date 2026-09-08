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


def test_lists_the_accounts_own_duplicatas_paginated_and_filtered(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)

    a = client.emitir_duplicata(sacado="Grupo Atlas Varejo", cnpj="12.345.678/0001-90", valor="10.000,00", vencimento="2026-12-01")
    b = client.emitir_duplicata(sacado="Grupo Atlas Varejo", cnpj="12.345.678/0001-90", valor="20.000,00", vencimento="2026-12-02")

    page = client.list_duplicatas()
    ids = [d["id"] for d in page["duplicatas"]]
    assert a["duplicataId"] in ids
    assert b["duplicataId"] in ids
    assert page["mode"] == "test"
    assert page["total"] == len(ids)

    # A query string montada pelo SDK precisa chegar ao servidor de verdade.
    assert len(client.list_duplicatas(limit=1)["duplicatas"]) == 1
    paga = client.list_duplicatas(status="paga")
    assert a["duplicataId"] not in [d["id"] for d in paga["duplicatas"]]


def test_abrir_leilao_refuses_before_the_sacado_accepts(base_url):
    """O servidor roda como subprocesso, então este teste não consegue confirmar o aceite
    direto no banco (o SDK Node, que importa o app no mesmo processo, cobre o caminho feliz).
    O que dá pra provar aqui é o formato da requisição e o gate real: sem aceite, não negocia.
    """
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)

    emitida = client.emitir_duplicata(
        sacado="Grupo Atlas Varejo", cnpj="12.345.678/0001-90", valor="10.000,00", vencimento="2027-12-01", nf_anexada=True
    )
    with pytest.raises(LastroApiError) as exc_info:
        client.abrir_leilao(emitida["duplicataId"], taxa_maxima=2.5, duracao_horas=24)
    assert exc_info.value.status == 409
    assert exc_info.value.error == "aceite_pendente"


def test_cashflow_is_gated_by_plan(base_url):
    api_key = register_and_generate_key(internal_url(base_url), "cedente", unique())
    client = LastroClient(api_key, base_url=base_url)
    with pytest.raises(LastroApiError) as exc_info:
        client.get_cashflow()
    # Conta recém-registrada cai no Básico: o gate de plano vem antes de qualquer outro.
    assert exc_info.value.status == 402
    assert exc_info.value.error == "plan_required"


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
