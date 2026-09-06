import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { CreateWebhookDto } from './webhooks.dto';
import { WebhooksService } from './webhooks.service';

@Controller()
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('webhooks')
  @HttpCode(202)
  receive(@Body() body: CreateWebhookDto) { return this.webhooks.receive(body); }

  @Get('events')
  events() { return this.webhooks.list(); }

  @Post('events/:eventId/retry')
  retry(@Param('eventId') eventId: string) { return this.webhooks.retry(eventId); }

  @Get('health')
  health() { return { ok: true }; }
}
