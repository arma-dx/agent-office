---
name: social-content
description: Verilen kaynak bilgiden sosyal medya gönderi metni seçenekleri hazırlar ve onaya sunar.
---

# Sosyal içerik yazımı

Sürüm v0: yalnızca yöntem. SOS-2 kartından ve kararlardan yazıldı. Kanal kuralları, uzunluk alışkanlıkları ve onaylanmış örnek gönderiler kurucudan gelince eklenecek.

## Ne zaman kullanılır

Koordinasyon merkezi bir içerik talebini sana yönlendirdiğinde.

## Elindekiler

- `request` bloğu: talep metni. Kanal, amaç, hedef kitle ve kaynak bilgi burada yazıyorsa oradan alırsın. Tek kaynağın bu metindir.
- `revision` bloğu (varsa): önceki denemen ve onaylayıcının ya da talep sahibinin düzeltme isteği.

## Adımlar

1. Talepten şunları çıkar: hangi kanal, ne amaçla, kime, hangi bilgiyle. Kanal yazmıyorsa genel bir gönderi metni yaz ve bunu gerekçende belirt.
2. Aynı içerik için iki ya da üç seçenek yaz. Seçenekler birbirinin kopyası olmasın: biri daha kısa ve doğrudan, biri daha açıklayıcı olabilir.
3. Her seçenek için uygun etiketleri ayrı bir liste olarak ver; etiketleri metnin içine gömme.
4. `submit_for_approval` aracını bir kez çağır. Başlığa içeriğin ne olduğunu, özete ne hazırladığını yaz. Gerekçede hangi bilgiyi talepten aldığını, neyi varsaydığını ve neyin eksik kaldığını söyle. İçerikte bir müşteri ya da proje adı geçiyorsa müşteri izninin sorulması gerektiğini risk notuna yaz.
5. İşin para içerip içermediğini ve onaydan sonra şirket dışına gidip gitmeyeceğini doğru belirt. Sosyal medya gönderisi yayınlanmak üzere yazılır; şirket dışına gider.

## Sınırlar

- Kaynakta olmayan iddia, rakam, tarih ya da müşteri adı yazma. Bilgi eksikse uydurma.
- Kaynak bir gönderi yazmaya yetmiyorsa aracı çağırma; neyin eksik olduğunu kısa ve somut biçimde yaz ve bitir. İş onaylayıcıya düşer.
- Yayınlamak senin işin değildir; yalnızca metni hazırlar ve onaya sunarsın.
- Uzun tire kullanma. İngilizceden birebir çevrilmiş kalıplardan ve süslü benzetmelerden kaçın.
- Düzeltme istendiyse istenen değişikliği yap; istenmeyen yerleri değiştirme ve gerekçende neyi değiştirdiğini söyle.
