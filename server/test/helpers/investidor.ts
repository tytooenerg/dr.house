import { approveKyb, setVeiculo } from '../../src/db/users.js';

/**
 * Credencia um investidor do jeito que a plataforma passou a exigir: KYB aprovado **e**
 * veículo classificado (migração 0070). Aprovar sem classificar deixa a conta num estado que
 * o gate de lance recusa — e é isso que a rota do admin agora impede de acontecer.
 *
 * O padrão nos testes era `credenciarInvestidor(id)` sozinho, de quando a única pergunta era "o KYB
 * passou?". Comprar direito creditório é atividade regulada, então passou a haver uma segunda:
 * sob qual veículo. 'fundo' é o default aqui só porque a maioria dos testes não se importa com
 * qual é — quem testa o veículo em si passa o dele.
 */
export function credenciarInvestidor(userId: number, veiculo: 'banco' | 'fidc' | 'fundo' | 'factoring' = 'fundo') {
  approveKyb(userId);
  setVeiculo(userId, veiculo);
}
