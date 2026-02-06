export async function sendSlackNotification(message: string, payload?: any) {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL

  if (!webhookUrl) {
    console.warn('SLACK_WEBHOOK_URL is not defined')
    return
  }

  try {
    const blocks = [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: message,
        },
      },
    ]

    if (payload) {
      // Convert payload object to readable text format
      const fields = Object.entries(payload).map(([key, value]) => {
        return `• *${key}*: ${value}`
      }).join('\n')

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: fields,
        },
      })
    }

    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ blocks }),
    })
  } catch (error) {
    console.error('Failed to send Slack notification:', error)
  }
}
