import type {LibraryBook} from './library';
export const BOOK_RESUME_CHANGED='judu:reading-progress-updated';
type StorageReader=Pick<Storage,'getItem'>;
export function bookResumeEdition(storage:StorageReader,book:LibraryBook):string|undefined{
 const saved=storage.getItem('judu:edition:'+book.id);
 if(!saved||!/^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/u.test(saved))return undefined;
 // WHY：是否读过以每本书的版本记录为准，active-book 只决定启动时打开哪一本，不能代表整座书架的阅读历史。
 // 旧接口没有版本列表时保留候选版本，正文入口拿到完整书架后会再次验证归属。
 return book.editions===undefined||book.editions.some(edition=>edition.id===saved)?saved:undefined;
}
export function readBookResumes(storage:StorageReader,books:readonly LibraryBook[]):Record<string,string>{
 return Object.fromEntries(books.flatMap(book=>{const edition=bookResumeEdition(storage,book);return edition?[[book.id,edition]]:[];}));
}
export function bookResumeHref(bookId:string,editionId?:string):string{
 return '/?'+new URLSearchParams({bookId,...(editionId?{editionId}:{})});
}
