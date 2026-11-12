# Update Relative Links

[中文](./README_zh.md)

Update Relative Links는 노트 이동·폴더 리팩터링 이후에도 모든 Markdown 링크를 항상 올바른 상대 경로로 유지하도록 도와주는 Obsidian 플러그인입니다. Obsidian 기본 옵션인 “Automatically update internal links”의 한계를 보완하고, Renewer 프로토타입에서 영감을 받은 검증 절차와 자산 관리 기능을 통합했습니다.[^obsidian-docs]

[^obsidian-docs]: [Obsidian Help Center](https://docs.obsidian.md/Home)

## 핵심 기능

1. **실시간 리네임 대응** – 파일을 다른 디렉터리로 이동하면 해당 파일 안의 모든 링크·임베드 경로가 즉시 다시 계산됩니다.
2. **전체 볼트 일괄 수정 명령** – 커맨드 팔레트에서 한 번에 Vault 전체를 스캔하여 상대 경로와 타이틀을 재작성할 수 있습니다. *드라이런* 명령을 사용하면 실제 저장 없이 미리보기만 수행합니다.
3. **타이틀 정규화** – 경로가 그대로 노출된 링크 텍스트를 깔끔한 파일명으로 바꿔 어떤 Markdown 에디터에서도 읽기 쉬운 상태를 유지합니다.
4. **이미지 폭 접미사 자동 추가** – 필요 시 이미지 Alt 텍스트에 `|650`(사용자 지정 가능)을 자동 덧붙여 CSS 기반 폭 제어 규칙과 호환됩니다.
5. **임베드 자산 미러링** – `../`로 상위 폴더를 참조하는 이미지가 있으면 현재 노트 하위의 `_assets`(기본값) 폴더로 복사하고 링크까지 갱신합니다.
6. **상세 로그** – Verbose 모드를 켜면 모든 치환 결과를 콘솔에 남겨 배포 전 검토나 Git 커밋 메시지 작성에 도움을 줍니다.

## 명령어

| Command | 설명 |
| --- | --- |
| `Update all relative links` | Vault 전체를 스캔해 경로·타이틀을 수정한 뒤 저장합니다. |
| `Preview relative link updates (dry run)` | 동일한 검사를 수행하되 파일은 수정하지 않고, 변경 예정 파일 상위 _N_개만 노티스로 보여줍니다. |
| `Update relative links in current file` | 현재 활성 노트 한 개만 즉시 검사해 필요한 링크를 수정합니다. |
| `Update relative links in current folder` | 현재 노트가 위치한 폴더(동일 경로)의 Markdown 파일만 대상으로 일괄 업데이트합니다. |

명령 실행 시(`Ctrl/Cmd + P`) 대규모 수정이 가능하므로 항상 확인 모달이 표시됩니다. 좌측 리본에도 동일 기능의 아이콘(모두 실행, 드라이런, 현재 파일 실행, 현재 폴더 실행)이 추가되어 있어 마우스로도 빠르게 실행할 수 있습니다.

## 자동 리네임 처리

플러그인을 활성화하면 `rename` 이벤트를 구독합니다. 노트가 다른 폴더로 이동하면 짧은 디바운스 이후 동일한 링크 처리 엔진이 실행되고, 실제로 수정된 파일은 Obsidian Notice로 알려줍니다.

## 설정 요약

| 설정 | 설명 |
| --- | --- |
| Normalize link titles | 비어 있거나 경로가 그대로 노출된 타이틀을 대상 파일명( `.md` 제외)으로 재작성합니다. |
| Auto append image width | 이미지 Alt 텍스트에 `|650` 등의 접미사를 자동으로 붙입니다. |
| Copy embedded assets locally | `../` 등을 통해 다른 폴더를 참조하는 이미지를 현재 노트 폴더로 복사합니다. 원본을 참조하는 다른 노트가 없으면 원본은 볼트 `.trash` 폴더로 보냅니다(복원 가능). 원본 파일명이 다른 노트·캔버스 본문에 하나라도 나오면 남깁니다. 그 결과 원본 폴더가 비면 빈 폴더를 지웁니다. |
| Asset mirror subfolder | 자산을 복사할 서브 폴더 이름(기본 `_assets`). |
| Dry run preview limit | 드라이런 후 노티스에 표시할 파일 요약 개수. |
| Verbose logging | 모든 치환 내역을 개발자 콘솔에 출력합니다. |

설정은 **Settings → Community plugins → Update Relative Links**에서 변경할 수 있습니다.

## 권장 사용 순서

1. 플러그인을 활성화하고 각 옵션(폭 접미사, 자산 폴더 등)을 검토합니다.
2. **Preview** 명령으로 변경 규모를 먼저 파악합니다.
3. Vault 백업 또는 Git 커밋을 생성합니다.
4. **Update all relative links** 명령을 실행해 실제 수정을 적용합니다.
5. Verbose 모드 또는 Git diff로 결과를 검증합니다.

## 요구 사항 및 제한

- Markdown 링크 문법을 사용해야 하며, “Use [[Wikilinks]]” 옵션은 꺼져 있어야 합니다.
- 자산 복사는 데스크톱 앱의 `FileSystemAdapter`를 사용하므로 모바일에서는 생략됩니다.
- Vault 내부에 이미 존재하는 파일만 복사 대상이며 외부 URL은 변경하지 않습니다.
- Markdown 파일 이외의 대상은 무시되지만, 임베드 자산으로 참조될 경우에만 복사 로직이 실행됩니다.

## 상대 경로를 사용해야 하는 이유

Obsidian은 순수 Markdown 파일을 기반으로 하므로, 상대 경로를 유지하면 다음과 같은 장점이 있습니다.

- VS Code, GitHub, 정적 사이트 파이프라인 등 다른 환경에서도 링크가 정상 작동합니다.
- 폴더 이동 시 Git diff가 최소화되어 변경 관리가 용이합니다.
- 외부 백업·배포 시 별도의 전처리 없이 즉시 활용할 수 있습니다.

Update Relative Links는 이러한 이점을 자동화하여 언제든 Vault 구조를 마음껏 재배치할 수 있도록 지원합니다.
