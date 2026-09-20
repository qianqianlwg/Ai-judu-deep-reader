import{expect,it}from'vitest';
import{buildMobiSourceIndex}from'./mobi-source-map.mjs';
import{reconstructKf8Source}from'./mobi-source-bytes.mjs';
const bytes=(s:string)=>new TextEncoder().encode(s);
it('MOBI字节位置跨Unicode、实体与重复段落，不能使用UTF16下标或id猜位置',()=>{
 const html='<p id="same">甲😀 &amp; 第二段</p><p id="same">甲😀 &amp; 第二段</p>';
 const source={id:'0',encoding:65001,bytes:bytes(html),fileStart:50};const index=buildMobiSourceIndex('mobi',[source],[{id:'0',html}]);
 const second=html.lastIndexOf('第二段'),byte=bytes(html.slice(0,second)).length;
 expect(index.resolve('filepos:'+(50+byte))).toMatchObject({chapterId:'0',byteOffset:byte,htmlOffset:second,point:{kind:'text',path:[1,0],offset:6,textLength:9}});
 const emoji=bytes(html.slice(0,html.indexOf('😀'))).length;expect(index.resolve('filepos:'+(50+emoji+1))).toBeNull();
 expect(index.resolve('filepos:'+(50+bytes(html.slice(0,html.indexOf('&amp;')+2)).length))).toBeNull();
});
it('KF8片段重建后的定位仍按fid/off字节；不选择同名下一元素',()=>{
 const skeleton=bytes('<body><p>外部</p></body>'),first=bytes('<p>😀文本</p>'),at=bytes('<body>').length;
 const result=reconstructKf8Source(skeleton,[{fid:7,insertOffset:at,bytes:first}]);const html=new TextDecoder().decode(result.bytes);
 const index=buildMobiSourceIndex('kf8',[{id:'k',encoding:65001,...result}],[{id:'k',html}]);
 expect(index.resolve('kindle:pos:fid:7:off:0')).toMatchObject({chapterId:'k',byteOffset:at,point:{kind:'element',path:[0],tag:'p'}});
 expect(index.resolve('kindle:pos:fid:7:off:7')).toMatchObject({point:{kind:'text',path:[0,0],offset:2}});
 expect(index.resolve('kindle:pos:fid:7:off:4')).toBeNull();expect(index.resolve('kindle:pos:fid:8:off:0')).toBeNull();
});
it('输出HTML结构或文本被删改时拒绝，资源属性改写不影响同一点',()=>{
 const html='<p>一</p><p>二</p><img src="kindle:embed:1"/>';const source={id:'0',encoding:65001,bytes:bytes(html),fileStart:0};
 expect(buildMobiSourceIndex('mobi',[source],[{id:'0',html:html.replace('kindle:embed:1','mobi-resource-v1/1.png')}]).resolve('filepos:0')?.point.kind).toBe('element');
 expect(buildMobiSourceIndex('mobi',[source],[{id:'0',html:'<p>二</p>'}]).resolve('filepos:0')).toBeNull();
});
it('半开章节边界、缺失fid和非法映射拒绝',()=>{
 const a=bytes('<p>a</p>'),b=bytes('<p>b</p>');const index=buildMobiSourceIndex('mobi',[{id:'a',encoding:65001,bytes:a,fileStart:0},{id:'b',encoding:65001,bytes:b,fileStart:a.length}],[{id:'a',html:'<p>a</p>'},{id:'b',html:'<p>b</p>'}]);
 expect(index.resolve('filepos:'+a.length)?.chapterId).toBe('b');expect(index.resolve('filepos:'+(a.length+b.length))).toBeNull();
 expect(()=>buildMobiSourceIndex('kf8',[{id:'a',encoding:65001,bytes:a,spans:[{fid:0,start:1,end:2,targetStart:0}]}],[{id:'a',html:'<p>a</p>'}])).toThrow('起点');
});
it('稀疏来源、章节缺失和不安全file区间拒绝',()=>{
 const html='<p>a</p>',source={id:'0',encoding:65001,bytes:bytes(html),fileStart:0};
 expect(()=>buildMobiSourceIndex('mobi',[source],new Array(1))).toThrow('身份');
 expect(()=>buildMobiSourceIndex('mobi',new Array(1),[{id:'0',html}])).toThrow('身份');
 expect(()=>buildMobiSourceIndex('mobi',[{...source,fileStart:Number.MAX_SAFE_INTEGER}],[{id:'0',html}])).toThrow('起点');
 expect(()=>buildMobiSourceIndex('mobi',[source,{...source,id:'1',fileStart:2}],[{id:'0',html},{id:'1',html}])).toThrow('重叠');
});
it.each([
 [{fid:0,start:0,end:3,targetStart:0},{fid:1,start:0,end:2,targetStart:2}],
 [{fid:0,start:0,end:2,targetStart:0},{fid:0,start:3,end:4,targetStart:4}],
 [{fid:0,start:0,end:3,targetStart:0},{fid:0,start:2,end:4,targetStart:5}],
 [{fid:0,start:0,end:2,targetStart:Number.MAX_SAFE_INTEGER}],
 new Array(1),
])('片段重叠、缺口、越界或稀疏映射拒绝 %#',spans=>{
 const html='<p>abcdef</p>';expect(()=>buildMobiSourceIndex('kf8',[{id:'0',encoding:65001,bytes:bytes(html),spans}],[{id:'0',html}])).toThrow(/片段/);
});
it('FID不能跨章；全书片段预算在解析前限制',()=>{
 const html='<p>abc</p>',source={id:'0',encoding:65001,bytes:bytes(html),spans:[{fid:0,start:0,end:1,targetStart:0}]};
 expect(()=>buildMobiSourceIndex('kf8',[source,{...source,id:'1'}],[{id:'0',html},{id:'1',html}])).toThrow('串章');
 expect(()=>buildMobiSourceIndex('kf8',[{...source,spans:new Array(20001)}],[{id:'0',html}])).toThrow('超限');
});
it('片段split后的原始offset连续而目标可被另一fid分开，skeleton留白允许',()=>{
 const result=reconstructKf8Source(bytes('<body></body>'),[{fid:0,insertOffset:6,bytes:bytes('<p>甲乙</p>')},{fid:1,insertOffset:12,bytes:bytes('😀')}]);
 const html=new TextDecoder().decode(result.bytes),index=buildMobiSourceIndex('kf8',[{id:'0',encoding:65001,...result}],[{id:'0',html}]);
 expect(index.resolve('kindle:pos:fid:0:off:6')).toMatchObject({point:{kind:'text',offset:3},byteOffset:16});
 expect(index.resolve('kindle:pos:fid:1:off:0')).toMatchObject({point:{kind:'text',offset:1}});
});
it('body容器不属于正文子节点协议，不把它猜成第一个带ID的元素',()=>{
 const html='<html><head><title>书</title></head><body><p>正文</p></body></html>',source={id:'0',encoding:65001,bytes:bytes(html),fileStart:0};
 for(const rendered of [html,'<p>正文</p>']){const index=buildMobiSourceIndex('mobi',[source],[{id:'0',html:rendered}]);expect(index.resolve('filepos:'+bytes(html.slice(0,html.indexOf('<body>'))).length)).toBeNull();}
});
