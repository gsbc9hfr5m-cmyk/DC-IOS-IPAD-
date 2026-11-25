import { DcError } from '@/dc/errors';
import {
  extractDivInner,
  htmlToText,
  isDeletedPostPage,
  parseCsrfToken,
  parseDcDate,
  parseGallogList,
  parseGuestbookList,
  parseGuestbookYears,
  parseHiddenInput,
  parseListDirect,
  parseLoggedInUid,
  parsePostView,
} from '@/dc/parsers';

import * as F from './fixtures';

function expectStructureChanged(fn: () => unknown, pathPart?: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(DcError);
    expect((e as DcError).code).toBe('structureChanged');
    if (pathPart) expect(String((e as DcError).debug.path)).toContain(pathPart);
    return;
  }
  throw new Error('structureChanged 오류가 나지 않았습니다');
}

describe('parseGallogList', () => {
  it('글과 댓글을 정규화한다', () => {
    const page = parseGallogList(
      F.gallogList(
        [
          F.gallogItem(),
          F.gallogItem({
            type: 'D',
            no: '1002',
            cno: '31940000',
            wdate: '2025-10-10',
            re_comment: true,
            memo: '<span class="mention">@ㅇㅇ</span>좋아요<img src="https://dcimg5.dcinside.com/dccon.php?no=1" class="written_dccon" alt="4" />',
          }),
        ],
        { total: '2' },
      ),
    );
    expect(page.total).toBe(2); // 문자열 total도 숫자로
    expect(page.isOwner).toBe(true);
    const [post, comment] = page.items;
    expect(post).toMatchObject({ kind: 'post', gallery: 'general', logNo: '1001', postNo: '9001', commentNo: null });
    expect(post!.subject).toBe('테스트 글 & 제목');
    expect(post!.writtenAt).toBe('2024-03-05T13:45:10');
    expect(comment).toMatchObject({ kind: 'comment', gallery: 'minor', commentNo: '31940000', isReply: true });
    expect(comment!.writtenAt).toBe('2025-10-10T13:45:10');
    expect(comment!.memoText).toBe('@ㅇㅇ좋아요[디시콘]');
  });

  it('모르는 type 코드면 구조 변경으로 본다 (추측해서 지우지 않음)', () => {
    expectStructureChanged(() => parseGallogList(F.gallogList([F.gallogItem({ type: 'Z' })])), 'type(Z)');
  });

  it('필수 필드가 없으면 구조 변경', () => {
    expectStructureChanged(() => parseGallogList(F.gallogList([F.gallogItem({ no: undefined })])), '.no');
    expectStructureChanged(() => parseGallogList(F.gallogList([F.gallogItem({ wdate: '어제' })])), '.wdate');
    expectStructureChanged(() => parseGallogList(F.gallogList([], { managerskill: undefined })), 'managerskill');
    expectStructureChanged(() => parseGallogList({ gallog_list: { data: [] } }), 'gallog_info');
    expectStructureChanged(() => parseGallogList([]), '$');
  });
});

describe('방명록', () => {
  it('목록을 정규화하고 권한을 계산한다', () => {
    const page = parseGuestbookList(
      F.guestbookList([
        F.guestbookItem({ reple: [F.guestbookItem({ no: '78', write_time: '2019.07.02 10:00:00' })] }),
        F.guestbookItem({ no: '79', category: '0', ismember: '0', del_scope: true }),
      ], false),
    );
    expect(page.items[0]).toMatchObject({ no: '77', year: 2019, writtenAt: '2019-07-01T09:30:00', canDelete: false, secret: false });
    expect(page.items[0]!.memoText).toBe('안녕하세요\n반가워요');
    expect(page.items[0]!.replies[0]!.no).toBe('78');
    expect(page.items[1]).toMatchObject({ secret: true, isMember: false, canDelete: true });
  });

  it('갤로그 주인이면 모두 삭제 가능', () => {
    const page = parseGuestbookList(F.guestbookList([F.guestbookItem()], true));
    expect(page.items[0]!.canDelete).toBe(true);
  });

  it('연도 선택 상자에서 연도를 중복 없이 내림차순으로', () => {
    expect(parseGuestbookYears(F.gallogHtml())).toEqual([2021, 2019]);
    expect(parseGuestbookYears('<html></html>')).toEqual([]);
  });

  it('작성일 형식이 다르면 구조 변경', () => {
    expectStructureChanged(() => parseGuestbookList(F.guestbookList([F.guestbookItem({ write_time: 'yesterday' })])), 'write_time');
  });
});

describe('HTML 도우미', () => {
  it('csrf, hidden input(속성 순서 무관), 로그인 uid', () => {
    const html = F.gallogHtml();
    expect(parseCsrfToken(html)).toBe(F.CSRF);
    expect(parseHiddenInput(html, 'user_id')).toBe(F.UID);
    expect(parseHiddenInput(html, 'g_id')).toBe(F.UID);
    expect(parseHiddenInput(html, 'nope')).toBeNull();
    expect(parseLoggedInUid(F.homeHtmlLoggedIn)).toBe(F.UID);
    expect(parseLoggedInUid(F.homeHtmlLoggedOut)).toBeNull();
  });

  it('날짜 형식 세 가지', () => {
    expect(parseDcDate('2024.03.05', '01:02:03')).toBe('2024-03-05T01:02:03');
    expect(parseDcDate('2024-03-05')).toBe('2024-03-05T00:00:00');
    expect(parseDcDate('2019.07.01 09:30')).toBe('2019-07-01T09:30:00');
    expect(parseDcDate('03/05/2024')).toBeNull();
  });

  it('htmlToText', () => {
    expect(htmlToText('a<br>b&lt;c&gt; &#39;d&#39; &#x41;')).toBe("a\nb<c> 'd' A");
  });

  it('중첩 div 추출', () => {
    expect(extractDivInner('<div class="x y"><div>a</div>b</div><div>c</div>', 'y')).toBe('<div>a</div>b');
    expect(extractDivInner('<div class="z"></div>', 'y')).toBeNull();
  });

  it('게시글 페이지', () => {
    const v = parsePostView(F.postViewHtml);
    expect(v).toMatchObject({ title: '테스트 제목', writtenAt: '2024-03-05T13:45:00', views: 1234, recommends: 56 });
    expect(v.bodyText).toContain('본문 내용');
    expect(v.bodyText).toContain('둘째 줄');
    expectStructureChanged(() => parsePostView('<html>다른 구조</html>'));
  });

  it('삭제된 게시글 판정', () => {
    expect(isDeletedPostPage(403, F.deletedPostHtml)).toBe(true);
    expect(isDeletedPostPage(403, '<html>forbidden</html>')).toBe(false);
    expect(isDeletedPostPage(200, F.deletedPostHtml)).toBe(false);
  });

  it('list-direct', () => {
    expect(parseListDirect({ gall_id: 'comic_new6' })).toBe('comic_new6');
    expectStructureChanged(() => parseListDirect({ gall_id: '../x' }));
  });
});
