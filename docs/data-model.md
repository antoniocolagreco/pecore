# Data model

## Account

Schema `Account` (`model`, `forge`, `service`). Table `accounts`.

| Zod field | Kind | Column |
| --- | --- | --- |
| `id` | all | `id` |
| `kind` | all | `kind` |
| `provider` | model | `provider` |
| `connector` | model | `connector` |
| `login` | model | `login` |
| `email` | model | `email` |
| `maxParallel` | model | `max_parallel` |
| `forge` | forge | `forge` |
| `host` | forge | `host` |
| `tool` | forge, service | `tool` |
| `user` | forge, service | `user` |
| `awsProfile` | forge | `aws_profile` |
| `author.name` | forge | `author_name` |
| `author.email` | forge | `author_email` |
| `service` | service | `service` |
| `site` | service | `site` |
| | | `position` |

## Profile

Schema `Profile`. Table `profiles`.

| Zod field | Column |
| --- | --- |
| `id` | `id` |
| `account` | `account` |
| `model` | `model` |
| `effort` | `effort` |
| | `position` |

## Agent

Schema `AgentDefinition` (`agent`, `pm`). Table `agents`.

| Zod field | Kind | Column |
| --- | --- | --- |
| `id` | all | `id` |
| `kind` | all | `kind` |
| `name` | all | `name` |
| `color` | all | `color` |
| `model.account` | agent | `account` |
| `model.model` | agent | `model` |
| `model.effort` | agent | `effort` |
| `compaction.auto` | agent | `compaction_auto` |
| `compaction.max` | agent | `compaction_max` |
| `cardId` | pm | `card_id` |
| | | `position` |
