import { describe, expect, it, vi } from 'vitest';
import { initialEpubSection, nearbyEpubSections, prepareEpubSections, prepareRemainingEpubSections } from './epub-preparation';
import type { FoliateBook } from './foliate-types';
function fixture(count=20):FoliateBook { return {sections:Array.from({length:count},(_,i)=>({id:String(i),createDocument:vi.fn(async()=>({}) as Document),load:async()=>null,unload:()=>{}}))}; }
describe('EPUB reading-position neighborhood',()=>{
  it('prepares ten nearby sections in distance order, including book boundaries',()=>{
    expect(nearbyEpubSections(20,10)).toEqual([10,11,9,12,8,13,7,14,6,15]);
    expect(nearbyEpubSections(20,0)).toEqual([0,1,2,3,4,5,6,7,8,9]);
    expect(nearbyEpubSections(3,2)).toEqual([2,1,0]);expect(nearbyEpubSections(0,0)).toEqual([]);
    expect(nearbyEpubSections(20,19)).toEqual([19,18,17,16,15,14,13,12,11,10]);
  });
  it('prefers saved CFI then canonical source href then first linear chapter',()=>{
    const book=fixture();book.sections[0].linear='no';book.resolveCFI=()=>({index:17,anchor:doc=>doc.body});book.resolveHref=()=>({index:12,anchor:doc=>doc.body});
    expect(initialEpubSection(book,{initialCfi:'saved',initialHref:'anchor'})).toBe(17);
    expect(initialEpubSection(book,{initialHref:'anchor'})).toBe(12);
    expect(initialEpubSection(book,{})).toBe(1);
    book.resolveCFI=()=>({index:99,anchor:doc=>doc.body});expect(initialEpubSection(book,{initialCfi:'bad',initialHref:'anchor'})).toBe(12);
  });
  it('foreground preparation never touches distant chapters',async()=>{
    const book=fixture();const indices=nearbyEpubSections(20,16);await prepareEpubSections(book,indices);
    book.sections.forEach((section,index)=>expect(section.createDocument).toHaveBeenCalledTimes(indices.includes(index)?1:0));
  });
  it('prepares the rest in the background and stops when cancelled',async()=>{
    const book=fixture(3),controller=new AbortController();
    await prepareRemainingEpubSections(book,new Set([1]),controller.signal);
    expect(book.sections[0].createDocument).toHaveBeenCalledOnce();expect(book.sections[1].createDocument).not.toHaveBeenCalled();expect(book.sections[2].createDocument).toHaveBeenCalledOnce();
    controller.abort();await expect(prepareRemainingEpubSections(book,new Set(),controller.signal)).rejects.toThrow();
  });
});
