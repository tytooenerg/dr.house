"""Zero-dependency Python client for the Lastro Partner API (/api/v1).

Uses only the standard library (urllib) — no `requests`, no code generation. One
method per real endpoint in server/src/routes/v1.ts, matching the OpenAPI spec
served at GET /api/v1/openapi.json. See sdks/node for the equivalent TypeScript
client, built to the same shape.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Dict, List, Optional

from .errors import LastroApiError, LastroNetworkError

DEFAULT_BASE_URL = "https://api.lastro.com.br/v1"


class LastroClient:
    def __init__(self, api_key: str, base_url: str = DEFAULT_BASE_URL, timeout: float = 15.0):
        if not api_key or not api_key.strip():
            raise ValueError("LastroClient requires a real api_key (from Desenvolvedores in the Lastro app).")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout

    def _request(self, method: str, path: str, body: Optional[dict] = None, idempotency_key: Optional[str] = None) -> Any:
        url = f"{self._base_url}{path}"
        headers = {"Authorization": f"Bearer {self._api_key}"}
        data: Optional[bytes] = None
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        req = urllib.request.Request(url, data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as resp:
                raw = resp.read()
                return json.loads(raw) if raw else {}
        except urllib.error.HTTPError as exc:
            raw = exc.read()
            try:
                payload = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                payload = {}
            raise LastroApiError(exc.code, payload) from exc
        except urllib.error.URLError as exc:
            raise LastroNetworkError(f"Failed to reach the Lastro API at {url}", exc) from exc

    @staticmethod
    def _quote(value: str) -> str:
        return urllib.parse.quote(value, safe="")

    # --- Duplicatas (cedente accounts) ---

    def emitir_duplicata(
        self,
        sacado: str,
        valor: str,
        vencimento: str,
        cnpj: str = "",
        seguro: bool = False,
        nf_anexada: bool = False,
        nfe_chave: str = "",
        batch_valores: Optional[List[str]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Emit a real duplicata escriturada. Requires a write-scope key on a cedente account."""
        body = {
            "sacado": sacado,
            "cnpj": cnpj,
            "valor": valor,
            "vencimento": vencimento,
            "seguro": seguro,
            "nfAnexada": nf_anexada,
            "nfeChave": nfe_chave,
            "batchValores": batch_valores or [],
        }
        return self._request("POST", "/duplicatas", body, idempotency_key)

    def get_duplicata(self, duplicata_id: str) -> Dict[str, Any]:
        return self._request("GET", f"/duplicatas/{self._quote(duplicata_id)}")

    def list_duplicatas(
        self,
        status: Optional[str] = None,
        limit: Optional[int] = None,
        offset: Optional[int] = None,
    ) -> Dict[str, Any]:
        """List this account's duplicatas, paginated.

        A test-mode key only ever sees sandbox rows, and a live key only real ones.
        """
        params = {}
        if status is not None:
            params["status"] = status
        if limit is not None:
            params["limit"] = str(limit)
        if offset is not None:
            params["offset"] = str(offset)
        suffix = f"?{urllib.parse.urlencode(params)}" if params else ""
        return self._request("GET", f"/duplicatas{suffix}")

    def abrir_leilao(
        self,
        duplicata_id: str,
        taxa_maxima: Optional[float] = None,
        duracao_horas: Optional[float] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Put a duplicata up for auction.

        Requires a write-scope key on a cedente account, and the duplicata must already be
        approved with the sacado's aceite confirmed. `taxa_maxima` is the reserve — the worst
        monthly discount rate the cedente is willing to take (0 to 20 % a.m.).
        """
        body: Dict[str, Any] = {}
        if taxa_maxima is not None:
            body["taxaMaxima"] = taxa_maxima
        if duracao_horas is not None:
            body["duracaoHoras"] = duracao_horas
        return self._request("POST", f"/duplicatas/{self._quote(duplicata_id)}/leilao", body, idempotency_key)

    # --- Fluxo de caixa (cedente accounts, plano Pro+) ---

    def get_cashflow(self) -> Dict[str, Any]:
        """Cash-flow forecast plus the decision engine's recommendation.

        This is what an external supervisor reads to decide *when* to anticipate. Live keys
        only: there is no sandbox cash position to serve.
        """
        return self._request("GET", "/cashflow")

    # --- Balcão (OTC) ---

    def list_otc(self) -> Dict[str, Any]:
        """Negociações de balcão em que esta conta é parte, dos dois lados da mesa.

        Não existe visão pública do balcão — uma negociação alheia não aparece aqui, nem por
        id. Live keys only: o balcão negocia posições reais entre duas contas, e não há
        contraparte de mentira em sandbox.
        """
        return self._request("GET", "/otc")

    def abrir_otc(
        self,
        duplicata_id: str,
        valor: Any,
        prazo_horas: Optional[float] = None,
        nota: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Abre uma negociação sobre a posição de outra conta.

        A duplicata NÃO precisa estar anunciada no book — é esse o ponto do balcão. O prazo é
        obrigatório (padrão 48h, teto 168h): uma proposta firme sem validade é uma opção de
        compra que ninguém pagou por ela.
        """
        body: Dict[str, Any] = {"duplicataId": duplicata_id, "valor": valor}
        if prazo_horas is not None:
            body["prazoHoras"] = prazo_horas
        if nota is not None:
            body["nota"] = nota
        return self._request("POST", "/otc", body, idempotency_key)

    def contrapropor_otc(
        self,
        negociacao_id: int,
        valor: Any,
        nota: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Troca o valor em cima da mesa e passa a vez pro outro lado.

        Só age quem está com a vez: quem fez a proposta que está na mesa aguarda a resposta.
        """
        body: Dict[str, Any] = {"valor": valor}
        if nota is not None:
            body["nota"] = nota
        return self._request("POST", f"/otc/{int(negociacao_id)}/contraproposta", body, idempotency_key)

    def aceitar_otc(self, negociacao_id: int, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """Aceita a proposta em cima da mesa — isto LIQUIDA.

        A posição troca de mãos e a taxa de plataforma é descontada do vendedor. Passe uma
        `idempotency_key`: um retry de rede sobre um aceite que já passou não pode comprar
        duas vezes.
        """
        return self._request("POST", f"/otc/{int(negociacao_id)}/aceitar", {}, idempotency_key)

    def encerrar_otc(
        self,
        negociacao_id: int,
        como: str = "recusada",
        idempotency_key: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Recusar e cancelar são o mesmo ato, visto de cada lado da mesa."""
        return self._request("POST", f"/otc/{int(negociacao_id)}/encerrar", {"como": como}, idempotency_key)

    # --- Marketplace ---

    def list_marketplace(self) -> Dict[str, Any]:
        return self._request("GET", "/marketplace")

    # --- Aceites (sacado accounts) ---

    def list_aceites(self) -> Dict[str, Any]:
        return self._request("GET", "/aceites")

    def decide_aceite(self, aceite_id: int, status: str, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """status: 'aceita' or 'contestada'. Requires a write-scope key."""
        return self._request("POST", f"/aceites/{aceite_id}/status", {"status": status}, idempotency_key)

    # --- Seguradora (insurer accounts) ---

    def get_seguradora_payload(self) -> Dict[str, Any]:
        return self._request("GET", "/seguradora")

    def decidir_sinistro(self, duplicata_id: str, decision: str, note: str, idempotency_key: Optional[str] = None) -> Dict[str, Any]:
        """decision: 'aprovado' or 'negado'. Requires a write-scope key on a seguradora account."""
        return self._request(
            "POST",
            f"/seguradora/sinistro/{self._quote(duplicata_id)}/decidir",
            {"decision": decision, "note": note},
            idempotency_key,
        )

    # --- Score / rede de sinais ---

    def get_score(self, cnpj: str) -> Dict[str, Any]:
        """Real-time blended credit score for a CNPJ — internal history + cross-partner signals."""
        return self._request("GET", f"/sacados/{self._quote(cnpj)}/score")

    def report_signal(self, cnpj: str, tipo: str, nota: Optional[str] = None) -> Dict[str, Any]:
        """tipo: 'pagamento_pontual' | 'atraso' | 'protesto' | 'contestacao'."""
        body: Dict[str, Any] = {"tipo": tipo}
        if nota is not None:
            body["nota"] = nota
        return self._request("POST", f"/sacados/{self._quote(cnpj)}/sinais", body)

    # --- PLD/AML screening ---

    def screen_pld(self, nome: str, documento: str = "") -> Dict[str, Any]:
        """Screen a name/document against the real OFAC SDN + UN sanctions lists."""
        return self._request("POST", "/pld/triagem", {"nome": nome, "documento": documento})
