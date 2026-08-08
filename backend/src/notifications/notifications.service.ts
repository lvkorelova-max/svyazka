import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    return this.prisma.userNotification.findMany({
      where: { recipientUserId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async unreadCount(userId: string) {
    const [unread, actionRequired] = await Promise.all([
      this.prisma.userNotification.count({
        where: { recipientUserId: userId, readAt: null },
      }),
      this.prisma.userNotification.count({
        where: {
          recipientUserId: userId,
          actionRequired: true,
          resolvedAt: null,
          supersededAt: null,
        },
      }),
    ]);
    return { unread, actionRequired };
  }

  async markRead(userId: string, notificationId: string) {
    const notification = await this.prisma.userNotification.findUnique({
      where: { id: notificationId },
    });
    if (!notification) throw new NotFoundException('Уведомление не найдено');
    if (notification.recipientUserId !== userId) {
      throw new ForbiddenException('Нет доступа к уведомлению');
    }
    if (notification.readAt) return notification;
    return this.prisma.userNotification.update({
      where: { id: notification.id },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string) {
    const result = await this.prisma.userNotification.updateMany({
      where: { recipientUserId: userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: result.count };
  }
}
