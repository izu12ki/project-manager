---
'web': minor
---

Cloudflare Workers の無料プランで動くようになりました。1 つの画面の読み取りを DB への 1〜2 回の往復にまとめ、日付の表示などの処理を軽くして、ふだんの画面の CPU 時間をおおむね 10ms に収めました。Backlog のユーザー取り込みは、無料プランの 1 リクエストあたりの上限（DB への問い合わせ・メール送信がそれぞれ 50 回）に収まるよう、8 人ずつ分けて送ります。無料プランではメールを SMTP2GO か Resend で送ってください（Cloudflare Email Sending は Workers Paid プランのみ）。
