

## Шаг 1: Проектирование базы данных Supabase

Создаём следующие таблицы:

### 1. `users` — Пользователи бота
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | Внутренний ID |
| telegram_id | bigint UNIQUE | Telegram User ID |
| username | text | @username |
| balance_pt | numeric(12,2) | Баланс в поинтах |
| balance_frozen | boolean | Заморожен ли баланс |
| is_banned | boolean | Забанен ли |
| is_suspicious | boolean | Подозрительный актив |
| referrer_id | uuid FK → users | Кто пригласил |
| captcha_count | int | Сколько капч получал |
| violation_count | int | Кол-во нарушений |
| created_at | timestamptz | Дата регистрации |

### 2. `user_ips` — Привязка IP к пользователям
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| ip_address | inet | IP адрес |
| first_seen_at | timestamptz | Первый вход с этого IP |
| last_seen_at | timestamptz | Последний вход |

UNIQUE constraint на (user_id, ip_address). Триггер: если по одному IP > 2 разных user_id → ставить `is_suspicious = true` всем и создавать алерт.

### 3. `tasks` — Задания на подписку
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| type | enum('subscribe', 'video') | Тип задания |
| channel_username | text | @канал для подписки (nullable) |
| channel_id | bigint | ID канала для проверки через Bot API |
| reward_pt | numeric(8,2) | Награда в PT |
| is_active | boolean | Активно ли |
| created_at | timestamptz | |

### 4. `task_completions` — Выполненные задания
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| task_id | uuid FK → tasks | |
| completed_at | timestamptz | |

UNIQUE на (user_id, task_id) — одно задание = один раз.

### 5. `video_ads` — Видеоролики для просмотра
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| title | text | Название |
| video_url | text | URL видео |
| duration_seconds | int | Обязательная длительность просмотра |
| reward_pt | numeric(8,2) | Награда за досмотр |
| is_active | boolean | |
| created_at | timestamptz | |

### 6. `video_views` — Просмотры видео (антифрод)
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| video_ad_id | uuid FK → video_ads | |
| ip_address | inet | IP при просмотре |
| started_at | timestamptz | Время открытия Mini App |
| finished_at | timestamptz nullable | Время завершения (null = не досмотрел) |
| rewarded | boolean | Начислена ли награда |

### 7. `withdrawals` — Выводы Stars
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| amount_pt | numeric(12,2) | Сумма в PT |
| amount_stars | numeric(12,2) | Сумма в Stars (по курсу) |
| status | enum('pending','approved','rejected') | Статус |
| ip_address | inet | IP при запросе |
| created_at | timestamptz | |
| processed_at | timestamptz nullable | |

### 8. `admin_alerts` — Алерты в админку
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| type | text | Тип алерта (suspicious_ip, withdrawal и т.д.) |
| user_id | uuid FK → users nullable | |
| message | text | Текст алерта |
| is_read | boolean | Прочитан ли |
| created_at | timestamptz | |

### 9. `settings` — Глобальные настройки
| Поле | Тип | Описание |
|------|------|----------|
| key | text PK | Ключ (например 'exchange_rate') |
| value | text | Значение |
| updated_at | timestamptz | |

### 10. `logs_activity` — Логи активности
| Поле | Тип | Описание |
|------|------|----------|
| id | uuid PK | |
| user_id | uuid FK → users | |
| action | text | Действие (login, task_complete, withdraw и т.д.) |
| ip_address | inet | |
| metadata | jsonb | Доп. данные |
| created_at | timestamptz | |

### Безопасность
- RLS включён на всех таблицах
- Триггерная функция на `user_ips`: при INSERT проверяет кол-во уникальных user_id по этому IP, если > 2 — помечает всех как suspicious и создаёт запись в `admin_alerts`
- API-токен бота и ID группы мониторинга будут храниться в Supabase Secrets

### Реализация
1. Создать все таблицы через миграции Supabase
2. Создать enum-типы для task_type и withdrawal_status
3. Создать триггер антифрода на user_ips
4. Включить RLS и настроить политики
5. Засеять settings с начальным exchange_rate = 1

