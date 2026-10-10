/**
 * Footer page texts, written into the CMS `pages` collection by a one-off seed.
 * Pages marked `publish: false` still contain {{PLACEHOLDER}} values and stay as drafts.
 */
export const COMPANY = {
  brand: 'Seçkin Çanta',
  owner: 'Ali Selim Seçkin',
  type: 'şahıs işletmesi',
  taxOffice: 'Kızılbey Vergi Dairesi',
  taxNo: '10702171762',
  address: '{{ADRES}}',
  phone: '{{TELEFON}}',
  email: '{{EPOSTA}}',
  site: '{{SITE}}',
}

const FREE_LIMIT = '1.500 TL'
const SHIPPING_FEE = '150 TL'

export type Block =
  | { h2: string }
  | { h3: string }
  | { p: string }
  | { ul: string[] }

export type PageSeed = { slug: string; title: string; publish: boolean; blocks: Block[] }

const sellerBlock: Block = {
  ul: [
    `Satıcı: ${COMPANY.owner} (${COMPANY.brand}, ${COMPANY.type})`,
    `Vergi dairesi / no: ${COMPANY.taxOffice} / ${COMPANY.taxNo}`,
    `Adres: ${COMPANY.address}`,
    `Telefon: ${COMPANY.phone}`,
    `E-posta: ${COMPANY.email}`,
    `İnternet sitesi: ${COMPANY.site}`,
  ],
}

export const PAGES: PageSeed[] = [
  {
    slug: 'kargo-ve-teslimat',
    title: 'Kargo ve Teslimat',
    publish: true,
    blocks: [
      { h2: 'Kargo ücreti' },
      {
        p: `${FREE_LIMIT} ve üzeri siparişlerde kargo ücretsizdir. ${FREE_LIMIT} altındaki siparişlerde kargo ücreti ${SHIPPING_FEE}’dir.`,
      },
      {
        p: 'Kargo ücreti, varsa kupon indirimi düşüldükten sonraki sepet tutarına göre hesaplanır ve ödeme adımında açıkça gösterilir.',
      },
      { h2: 'Teslimat süresi' },
      {
        p: 'Siparişiniz ödeme onayının ardından hazırlanıp kargoya verilir. Tahmini teslim süresi 2-4 iş günüdür. Hafta sonu ve resmî tatiller iş gününe dahil değildir.',
      },
      {
        p: 'Yoğun dönemlerde bu süre uzayabilir; her durumda siparişiniz yasal süre olan 30 gün içinde teslim edilir.',
      },
      { h2: 'Teslimat bölgesi' },
      { p: 'Şu anda yalnızca Türkiye içindeki adreslere gönderim yapıyoruz.' },
      { h2: 'Kargo takibi' },
      {
        p: 'Üye girişi yaparak verdiğiniz siparişlerde takip numarası, sipariş kargoya verildiğinde Hesabım › Siparişlerim sayfasında görünür. Üye olmadan verdiğiniz siparişler için sipariş numaranızla bize ulaşabilirsiniz.',
      },
      { h2: 'Teslim alırken' },
      {
        p: 'Paketi teslim alırken dışını kontrol edin. Ezik, yırtık veya ıslak bir paket fark ederseniz kargo görevlisine tutanak tutturun ve bize bildirin; ürünü sizin için yeniden gönderelim.',
      },
    ],
  },
  {
    slug: 'iade-ve-degisim',
    title: 'İade ve Değişim',
    publish: true,
    blocks: [
      { h2: 'Cayma hakkı' },
      {
        p: 'Ürünü teslim aldığınız günden itibaren 14 gün içinde hiçbir gerekçe göstermeden iade edebilirsiniz.',
      },
      { h2: 'İade kargo ücreti' },
      {
        p: 'İade kargo ücreti tarafımızdan karşılanır. Talebiniz onaylandığında size anlaşmalı kargo bilgisi iletilir; ürünü bu bilgiyle ücretsiz gönderebilirsiniz.',
      },
      { h2: 'Nasıl iade ederim?' },
      {
        ul: [
          'Üye girişi yaparak verdiğiniz siparişlerde: Hesabım › Siparişlerim › ilgili sipariş › İade talebi. Bu seçenek sipariş “Teslim Edildi” durumuna geçtiğinde açılır.',
          'Üye olmadan verdiğiniz siparişlerde: sipariş numaranızla İletişim sayfasındaki kanallardan bize ulaşın.',
        ],
      },
      { h2: 'Ürünün durumu' },
      {
        p: 'Ürünü inceleyebilirsiniz; ancak olağan kullanım dışında yıpranmamış olması gerekir. Mümkünse orijinal ambalajı, etiketi ve faturasıyla birlikte gönderin.',
      },
      { h2: 'Para iadesi' },
      {
        p: 'İade tutarı, cayma bildiriminizin bize ulaştığı tarihten itibaren en geç 14 gün içinde ödemeyi yaptığınız karta tek seferde iade edilir. Tutarın hesabınıza yansıma süresi bankanıza göre değişebilir.',
      },
      { h2: 'Değişim' },
      {
        p: 'Aldığınız ürünü renk veya model olarak değiştirebilirsiniz. Değişimde hem bize gönderim hem de yeni ürünün size gönderimi için kargo ücretini biz karşılarız. İstediğiniz ürün stokta yoksa ücret iadesi yapılır.',
      },
      { h2: 'Kusurlu ürün' },
      {
        p: 'Teslim aldığınız üründe üretimden kaynaklı bir kusur fark ederseniz bize bildirin; ürünü ücretsiz olarak değiştirir, onarır ya da bedelini iade ederiz. 6502 sayılı Tüketicinin Korunması Hakkında Kanun’dan doğan haklarınız saklıdır.',
      },
    ],
  },
  {
    slug: 'sss',
    title: 'Sıkça Sorulan Sorular',
    publish: true,
    blocks: [
      { h3: 'Siparişim ne zaman gelir?' },
      { p: 'Ödeme onayından sonra hazırlanıp kargoya verilir; tahmini teslim süresi 2-4 iş günüdür.' },
      { h3: 'Kargo ücreti ne kadar?' },
      { p: `${FREE_LIMIT} ve üzeri siparişlerde ücretsiz, altında ${SHIPPING_FEE}.` },
      { h3: 'Üye olmadan sipariş verebilir miyim?' },
      {
        p: 'Evet. Giriş sayfasındaki “Müşteri olmadan devam et” ile sepete ekleyip ödeme yapabilirsiniz. Üye olursanız siparişlerinizi ve kargo takibini hesabınızdan görebilirsiniz.',
      },
      { h3: 'Hangi ödeme yöntemlerini kullanabilirim?' },
      {
        p: 'Kredi kartı ve banka kartıyla, iyzico’nun güvenli ödeme sayfası üzerinden ödeme yapabilirsiniz. Kartınıza bağlı olarak 2, 3, 6 ve 9 taksit seçenekleri ödeme sayfasında gösterilir.',
      },
      { h3: 'Kart bilgilerim saklanıyor mu?' },
      { p: 'Hayır. Kart bilgileriniz yalnızca iyzico’nun ödeme sayfasına girilir; sitemizde saklanmaz.' },
      { h3: 'İade veya değişim yapabilir miyim?' },
      {
        p: 'Evet. Teslimattan itibaren 14 gün içinde iade edebilir, ürünü değiştirebilirsiniz. İade ve değişim kargo ücretlerini biz karşılarız. Ayrıntılar İade ve Değişim sayfasında.',
      },
      { h3: 'Siparişimi nasıl takip ederim?' },
      {
        p: 'Üye siparişlerinde takip numarası Hesabım › Siparişlerim sayfasında görünür. Üye olmadan verdiğiniz siparişler için sipariş numaranızla bize ulaşabilirsiniz.',
      },
      { h3: 'Ürünlerin malzemesi nedir?' },
      { p: 'Her ürünün malzemesi ve ölçüleri ürün sayfasında yazar.' },
      { h3: 'Yurt dışına gönderim yapıyor musunuz?' },
      { p: 'Şu anda yalnızca Türkiye içine gönderim yapıyoruz.' },
    ],
  },
  {
    slug: 'cerez-politikasi',
    title: 'Çerez Politikası',
    publish: true,
    blocks: [
      {
        p: `Bu politika, ${COMPANY.brand} internet sitesinde kullanılan çerezleri ve benzeri teknolojileri açıklar. Veri sorumlusu: ${COMPANY.owner} (${COMPANY.brand}).`,
      },
      { h2: 'Çerez nedir?' },
      {
        p: 'Çerezler, bir siteyi ziyaret ettiğinizde tarayıcınıza kaydedilen küçük metin dosyalarıdır. Benzer amaçla tarayıcının yerel depolama alanı da kullanılabilir.',
      },
      { h2: 'Kullandığımız çerezler' },
      {
        p: 'Sitemizde yalnızca sitenin çalışması için zorunlu olan çerezler ve yerel depolama kayıtları kullanılır:',
      },
      {
        ul: [
          'Oturum çerezleri: Üye girişi yaptığınızda oturumunuzun açık kalmasını sağlar.',
          'Misafir sepeti kaydı: Üye olmadan eklediğiniz ürünlerin sepetinizde kalmasını sağlar.',
          'Misafir favorileri kaydı: Üye olmadan favorilediğiniz ürünleri hatırlar.',
        ],
      },
      {
        p: 'Reklam, pazarlama veya ziyaretçi analizi amaçlı çerez kullanmıyoruz ve bu bilgileri üçüncü taraflarla paylaşmıyoruz.',
      },
      { h2: 'Çerezleri nasıl yönetebilirim?' },
      {
        p: 'Tarayıcı ayarlarınızdan çerezleri ve site verilerini silebilir veya engelleyebilirsiniz. Zorunlu çerezleri engellemeniz durumunda üye girişi ve sepet gibi özellikler çalışmayabilir.',
      },
      { h2: 'İletişim' },
      { p: 'Sorularınız için İletişim sayfasındaki kanallardan bize ulaşabilirsiniz.' },
    ],
  },
  {
    slug: 'kullanim-kosullari',
    title: 'Kullanım Koşulları',
    publish: true,
    blocks: [
      {
        p: `Bu internet sitesi ${COMPANY.owner} (${COMPANY.brand}, ${COMPANY.type}) tarafından işletilir. Siteyi kullanarak aşağıdaki koşulları kabul etmiş sayılırsınız.`,
      },
      { h2: 'Hesap' },
      {
        p: 'Üyelik sırasında verdiğiniz bilgilerin doğru olmasından ve şifrenizin gizliliğinden siz sorumlusunuz. Hesabınızda yetkisiz bir işlem fark ederseniz bize hemen bildirin.',
      },
      { h2: 'Ürün ve fiyat bilgileri' },
      {
        p: 'Ürün görselleri, açıklamaları ve fiyatları özenle hazırlanır. Görsellerdeki renkler ekran ayarlarına göre farklı görünebilir. Bariz bir fiyat veya stok hatası olması hâlinde siparişi iptal edip ödemenin tamamını iade etme hakkımız saklıdır.',
      },
      { h2: 'Fikrî haklar' },
      {
        p: `Sitedeki marka, logo, görsel ve metinler ${COMPANY.brand}’ya aittir; izin alınmadan kopyalanamaz veya ticari amaçla kullanılamaz.`,
      },
      { h2: 'Yasak kullanım' },
      {
        p: 'Siteyi hukuka aykırı amaçlarla kullanmak, sistemlere yetkisiz erişmeye çalışmak, otomatik araçlarla aşırı yük oluşturmak veya başkalarının hesaplarını kullanmak yasaktır.',
      },
      { h2: 'Satın alma' },
      {
        p: 'Satın alma işlemleri Ön Bilgilendirme Formu ve Mesafeli Satış Sözleşmesi hükümlerine tabidir. Kişisel verilerinizin işlenmesine ilişkin bilgi KVKK Aydınlatma Metni’nde yer alır.',
      },
      { h2: 'Değişiklikler' },
      {
        p: 'Bu koşulları gerektiğinde güncelleyebiliriz. Güncel metin her zaman bu sayfada yayınlanır.',
      },
      { h2: 'Uygulanacak hukuk' },
      {
        p: 'Bu koşullara Türkiye Cumhuriyeti hukuku uygulanır. Tüketici işlemlerinden doğan uyuşmazlıklarda Tüketici Hakem Heyetleri ve Tüketici Mahkemeleri yetkilidir.',
      },
    ],
  },
  {
    slug: 'kvkk',
    title: 'KVKK Aydınlatma Metni',
    publish: false,
    blocks: [
      {
        p: `6698 sayılı Kişisel Verilerin Korunması Kanunu (“KVKK”) uyarınca, veri sorumlusu sıfatıyla ${COMPANY.owner} (${COMPANY.brand}) olarak kişisel verilerinizi aşağıda açıklanan şekilde işliyoruz.`,
      },
      { h2: 'Veri sorumlusu' },
      sellerBlock,
      { h2: 'İşlenen kişisel veriler' },
      {
        ul: [
          'Kimlik: ad, soyad',
          'İletişim: e-posta adresi, telefon numarası, teslimat adresi',
          'Müşteri işlem: sipariş, sepet, favori, iade talebi ve ürün yorumu bilgileri',
          'İşlem güvenliği: IP adresi, oturum ve işlem kayıtları',
          'Finans: ödeme durumu ve tutarı (kart bilgileri iyzico tarafından işlenir, tarafımızca saklanmaz)',
        ],
      },
      { h2: 'İşleme amaçları' },
      {
        ul: [
          'Siparişlerin alınması, ödemenin alınması, ürünlerin teslimi',
          'İade, değişim ve müşteri taleplerinin yürütülmesi',
          'Üyelik hesabının oluşturulması ve yönetilmesi',
          'Fatura ve muhasebe gibi yasal yükümlülüklerin yerine getirilmesi',
          'Site güvenliğinin sağlanması ve kötüye kullanımın önlenmesi',
        ],
      },
      { h2: 'Hukuki sebepler' },
      {
        p: 'Kişisel verileriniz KVKK md. 5/2 kapsamında; sözleşmenin kurulması ve ifası (c), hukuki yükümlülüklerimizin yerine getirilmesi (ç) ve temel hak ve özgürlüklerinize zarar vermemek kaydıyla meşru menfaatlerimiz (f) hukuki sebeplerine dayanılarak işlenir.',
      },
      { h2: 'Aktarım' },
      {
        p: 'Kişisel verileriniz yalnızca yukarıdaki amaçlar için gerekli olduğu ölçüde şu taraflarla paylaşılır: ödeme kuruluşu (iyzico), kargo firması, yasal olarak yetkili kamu kurumları ve sitenin barındırma, veritabanı ve dosya depolama hizmetini sağlayan altyapı hizmet sağlayıcıları.',
      },
      {
        p: 'Altyapı hizmet sağlayıcılarımızın sunucuları yurt dışında bulunabilir. Bu aktarımlar KVKK md. 9’da öngörülen güvencelere uygun olarak yapılır.',
      },
      { h2: 'Toplama yöntemi' },
      {
        p: 'Verileriniz sitemizdeki üyelik, sipariş, iade ve iletişim formları ile site kullanımınız sırasında elektronik ortamda toplanır.',
      },
      { h2: 'Haklarınız' },
      {
        p: 'KVKK md. 11 uyarınca; verilerinizin işlenip işlenmediğini öğrenme, bilgi talep etme, işleme amacını öğrenme, aktarıldığı kişileri bilme, eksik veya yanlış işlenmişse düzeltilmesini, şartları oluştuğunda silinmesini veya yok edilmesini isteme, bu işlemlerin aktarılan kişilere bildirilmesini isteme, otomatik analiz sonucu aleyhinize bir sonuca itiraz etme ve kanuna aykırı işleme nedeniyle zarara uğramanız hâlinde zararın giderilmesini talep etme haklarına sahipsiniz.',
      },
      {
        p: `Başvurularınızı ${COMPANY.email} adresine e-posta ile ya da ${COMPANY.address} adresine yazılı olarak iletebilirsiniz. Başvurunuz en geç 30 gün içinde ücretsiz olarak sonuçlandırılır.`,
      },
    ],
  },
  {
    slug: 'gizlilik-politikasi',
    title: 'Gizlilik Politikası',
    publish: false,
    blocks: [
      {
        p: `${COMPANY.brand} olarak gizliliğinize önem veriyoruz. Bu politika, sitemizi kullanırken hangi bilgileri topladığımızı ve bunları nasıl koruduğumuzu açıklar.`,
      },
      { h2: 'Topladığımız bilgiler' },
      {
        p: 'Sipariş ve üyelik sırasında verdiğiniz ad, soyad, e-posta, telefon ve adres bilgileri ile sipariş geçmişiniz. Güvenlik amacıyla IP adresi ve oturum kayıtları.',
      },
      { h2: 'Ödeme bilgileri' },
      {
        p: 'Kart bilgileriniz sitemize girilmez ve tarafımızca saklanmaz. Ödeme, iyzico’nun güvenli ödeme sayfasında gerçekleşir.',
      },
      { h2: 'Bilgileri nasıl kullanıyoruz?' },
      {
        p: 'Siparişinizi teslim etmek, iade ve değişim taleplerinizi yürütmek, hesabınızı yönetmek ve yasal yükümlülüklerimizi yerine getirmek için. Bilgilerinizi satmıyor, reklam amacıyla paylaşmıyoruz.',
      },
      { h2: 'Güvenlik' },
      {
        p: 'Site trafiği şifreli bağlantı (HTTPS) üzerinden taşınır. Hesap verilerinize yalnızca siz ve yetkili personel erişebilir.',
      },
      { h2: 'Saklama süresi' },
      {
        p: 'Sipariş ve fatura bilgileri yasal saklama süreleri boyunca, üyelik bilgileri hesabınız açık kaldığı sürece saklanır. Hesabınızı Hesabım sayfasından silebilirsiniz.',
      },
      { h2: 'Çerezler ve haklarınız' },
      {
        p: 'Kullandığımız çerezler Çerez Politikası’nda, kişisel verilerinize ilişkin haklarınız KVKK Aydınlatma Metni’nde açıklanmıştır.',
      },
      { h2: 'İletişim' },
      { p: `${COMPANY.owner} – ${COMPANY.email} – ${COMPANY.phone}` },
    ],
  },
  {
    slug: 'on-bilgilendirme-formu',
    title: 'Ön Bilgilendirme Formu',
    publish: false,
    blocks: [
      { h2: '1. Satıcı bilgileri' },
      sellerBlock,
      { h2: '2. Ürün ve fiyat' },
      {
        p: 'Satın alınan ürünlerin temel nitelikleri, adedi ve vergiler dahil satış fiyatı ödeme sayfasındaki sipariş özetinde gösterilir. Fiyatlara KDV dahildir.',
      },
      { h2: '3. Kargo ücreti' },
      {
        p: `${FREE_LIMIT} ve üzeri siparişlerde kargo ücretsizdir. Altındaki siparişlerde ${SHIPPING_FEE} kargo ücreti alınır ve sipariş özetinde ayrıca gösterilir.`,
      },
      { h2: '4. Ödeme' },
      {
        p: 'Ödeme, kredi kartı veya banka kartıyla iyzico güvenli ödeme sayfası üzerinden yapılır. Taksit seçenekleri kartınıza göre ödeme sayfasında gösterilir.',
      },
      { h2: '5. Teslimat' },
      {
        p: 'Ürünler, sipariş formunda belirtilen teslimat adresine kargo ile gönderilir. Tahmini teslim süresi 2-4 iş günüdür; teslimat her durumda siparişten itibaren en geç 30 gün içinde yapılır.',
      },
      { h2: '6. Cayma hakkı' },
      {
        p: 'Ürünü teslim aldığınız günden itibaren 14 gün içinde hiçbir gerekçe göstermeden ve cezai şart ödemeden sözleşmeden cayabilirsiniz.',
      },
      {
        p: `Cayma bildiriminizi bu süre içinde ${COMPANY.email} adresine e-posta göndererek, ${COMPANY.address} adresine yazılı olarak veya üye siparişlerinde Hesabım › Siparişlerim üzerinden iade talebi oluşturarak iletebilirsiniz.`,
      },
      {
        p: 'İade kargo ücreti satıcı tarafından karşılanır. Ürünü cayma bildiriminden itibaren 10 gün içinde geri göndermeniz gerekir. Ödediğiniz tutar, cayma bildiriminin ulaşmasından itibaren 14 gün içinde ödeme yaptığınız karta iade edilir.',
      },
      {
        p: 'Ürünün olağan kullanımı dışındaki kullanım nedeniyle oluşan değişiklik ve bozulmalardan alıcı sorumludur.',
      },
      { h2: '7. Cayma hakkının kullanılamayacağı durumlar' },
      {
        p: 'Mesafeli Sözleşmeler Yönetmeliği md. 15 uyarınca, tüketicinin istekleri doğrultusunda kişiye özel olarak hazırlanan ürünlerde cayma hakkı kullanılamaz.',
      },
      { h2: '8. Şikâyet ve itirazlar' },
      {
        p: 'Şikâyetlerinizi yukarıdaki iletişim bilgilerinden bize iletebilirsiniz. Uyuşmazlık hâlinde, Ticaret Bakanlığınca her yıl belirlenen parasal sınırlar dahilinde yerleşim yerinizdeki veya işlemin yapıldığı yerdeki Tüketici Hakem Heyetine ya da Tüketici Mahkemesine başvurabilirsiniz.',
      },
    ],
  },
  {
    slug: 'mesafeli-satis-sozlesmesi',
    title: 'Mesafeli Satış Sözleşmesi',
    publish: false,
    blocks: [
      { h2: '1. Taraflar' },
      { p: 'Satıcı:' },
      sellerBlock,
      {
        p: 'Alıcı: Sipariş formunda adı, soyadı, iletişim ve teslimat bilgileri yer alan kişidir.',
      },
      { h2: '2. Konu' },
      {
        p: 'Bu sözleşme, alıcının satıcıya ait internet sitesi üzerinden elektronik ortamda siparişini verdiği ürünlerin satışı ve teslimine ilişkin olarak 6502 sayılı Tüketicinin Korunması Hakkında Kanun ve Mesafeli Sözleşmeler Yönetmeliği hükümleri uyarınca tarafların hak ve yükümlülüklerini düzenler.',
      },
      { h2: '3. Ürün, fiyat ve ödeme' },
      {
        p: `Ürünlerin türü, adedi, KDV dahil satış fiyatı ve kargo ücreti ödeme sayfasındaki sipariş özetinde belirtildiği gibidir. ${FREE_LIMIT} ve üzeri siparişlerde kargo ücretsizdir; altında ${SHIPPING_FEE} kargo ücreti alınır. Ödeme, iyzico güvenli ödeme sayfası üzerinden kartla yapılır.`,
      },
      { h2: '4. Teslimat' },
      {
        p: 'Ürünler, sipariş formunda belirtilen adrese kargo ile teslim edilir. Teslimat, siparişin satıcıya ulaşmasından itibaren en geç 30 gün içinde yapılır. Satıcı bu süre içinde teslim edemezse alıcı sözleşmeyi feshedebilir; bu durumda ödenen tutar 14 gün içinde iade edilir.',
      },
      {
        p: 'Satıcı, stokta kalmaması gibi sebeplerle sipariş edilen ürünü teslim edemeyeceğini anlarsa alıcıyı bilgilendirir ve ödenen tutarı 14 gün içinde iade eder.',
      },
      { h2: '5. Cayma hakkı' },
      {
        p: `Alıcı, ürünü teslim aldığı günden itibaren 14 gün içinde hiçbir gerekçe göstermeden ve cezai şart ödemeden sözleşmeden cayabilir. Cayma bildirimi ${COMPANY.email} adresine, ${COMPANY.address} adresine yazılı olarak veya üye siparişlerinde site üzerinden iade talebiyle yapılır.`,
      },
      {
        p: 'Alıcı, cayma bildiriminden itibaren 10 gün içinde ürünü satıcıya geri gönderir; iade kargo ücreti satıcıya aittir. Satıcı, cayma bildiriminin kendisine ulaşmasından itibaren 14 gün içinde ödenen tutarı alıcının ödeme yaptığı karta iade eder.',
      },
      {
        p: 'Ürünün olağan kullanımı dışındaki kullanım nedeniyle oluşan değişiklik ve bozulmalardan alıcı sorumludur. Kişiye özel hazırlanan ürünlerde cayma hakkı kullanılamaz.',
      },
      { h2: '6. Değişim ve ayıplı ürün' },
      {
        p: 'Alıcı, ürünü renk veya model olarak değiştirmek istediğinde değişime ilişkin kargo ücretleri satıcı tarafından karşılanır. Ürünün ayıplı olması hâlinde alıcı, 6502 sayılı Kanun md. 11’de sayılan seçimlik haklarını kullanabilir.',
      },
      { h2: '7. Uyuşmazlıkların çözümü' },
      {
        p: 'Bu sözleşmeden doğan uyuşmazlıklarda, Ticaret Bakanlığınca her yıl belirlenen parasal sınırlar dahilinde alıcının yerleşim yerindeki veya işlemin yapıldığı yerdeki Tüketici Hakem Heyetleri ile Tüketici Mahkemeleri yetkilidir.',
      },
      { h2: '8. Yürürlük' },
      {
        p: 'Alıcı, ödeme adımında bu sözleşmeyi ve Ön Bilgilendirme Formu’nu okuyup onayladığında sözleşme kurulmuş olur. Sözleşmenin bir örneği sipariş bilgileriyle birlikte satıcı tarafından saklanır.',
      },
    ],
  },
]
