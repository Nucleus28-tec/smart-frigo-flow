import { createFileRoute } from "@tanstack/react-router";

type PeriodResult = {
  period_id: string;
  label: string;
  changes: number;
  manual_preserved: number;
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";

function money(value: number) {
  return new Intl.NumberFormat("pt-BR").format(value);
}

function buildHtml(periods: PeriodResult[]) {
  const rows = periods
    .map(
      (p) =>
        `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee">${p.label}</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee">${money(p.changes)} alteração(ões)</td>` +
        `<td style="padding:6px 12px;border-bottom:1px solid #eee">${money(p.manual_preserved)} edição(ões) manual(is) preservada(s)</td></tr>`,
    )
    .join("");
  return `<div style="font-family:Arial,Helvetica,sans-serif;color:#1c1c1c">
    <h2>Rotta Financeiro — recálculo concluído</h2>
    <p>Os valores dos períodos abaixo foram atualizados automaticamente na rotina noturna.</p>
    <table style="border-collapse:collapse;font-size:14px">
      <thead><tr>
        <th align="left" style="padding:6px 12px">Período</th>
        <th align="left" style="padding:6px 12px">Mudanças</th>
        <th align="left" style="padding:6px 12px">Edições manuais</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <p style="font-size:13px;color:#555">Confira o detalhe em <strong>Atualizações</strong> e os relatórios em <strong>Demonstrativos</strong>.</p>
  </div>`;
}

async function sendResendEmail(to: string[], subject: string, html: string) {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  if (!lovableKey || !resendKey) {
    return { sent: false, error: "Resend não configurado (LOVABLE_API_KEY/RESEND_API_KEY)." };
  }
  const response = await fetch(`${GATEWAY_URL}/emails`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${lovableKey}`,
      "X-Connection-Api-Key": resendKey,
    },
    body: JSON.stringify({
      from: "Rotta Financeiro <onboarding@resend.dev>",
      to,
      subject,
      html,
    }),
  });
  const body = await response.text();
  if (!response.ok) {
    console.error(`Resend falhou [${response.status}]: ${body}`);
    return { sent: false, error: `Resend [${response.status}]: ${body}` };
  }
  return { sent: true, response: body };
}

export const Route = createFileRoute("/api/public/hooks/nightly-daily-refresh")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey =
          request.headers.get("apikey") ??
          request.headers.get("authorization")?.replace("Bearer ", "");
        const expected =
          process.env["SUPABASE_ANON_KEY"] ?? process.env["SUPABASE_PUBLISHABLE_KEY"];
        if (!expected || apikey !== expected) {
          return Response.json({ error: "Não autorizado" }, { status: 401 });
        }

        let payload: { test_email?: string } = {};
        try {
          payload = (await request.json()) as { test_email?: string };
        } catch {
          payload = {};
        }

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

        const { data, error } = await supabaseAdmin.rpc("nightly_refresh_periods");
        if (error) {
          console.error("nightly-daily-refresh falhou:", error.message);
          return Response.json({ error: error.message }, { status: 500 });
        }

        const result = (data ?? {}) as { refreshed?: number; periods?: PeriodResult[] };
        const periods = result.periods ?? [];

        if (periods.length === 0 && !payload.test_email) {
          return Response.json({ refreshed: 0, emailed: 0 });
        }

        let recipients: string[] = [];
        if (payload.test_email) {
          recipients = [payload.test_email];
        } else {
          const { data: users } = await supabaseAdmin
            .from("profiles")
            .select("email")
            .eq("is_active", true);
          recipients = (users ?? []).map((u) => u.email).filter(Boolean);
        }

        const email =
          recipients.length > 0
            ? await sendResendEmail(
                recipients,
                "Rotta Financeiro — recálculo concluído / valores atualizados",
                buildHtml(
                  periods.length > 0
                    ? periods
                    : [
                        {
                          period_id: "teste",
                          label: "Envio de teste",
                          changes: 0,
                          manual_preserved: 0,
                        },
                      ],
                ),
              )
            : { sent: false, error: "Nenhum destinatário ativo." };

        return Response.json({
          refreshed: periods.length,
          periods,
          recipients: recipients.length,
          email,
        });
      },
    },
  },
});
