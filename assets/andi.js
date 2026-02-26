var endtype = function() {
  $(".typed-cursor").hide();
};

var tagline = function() {
  $(".typed-cursor").hide();
  $(".content").delay(5).fadeIn(1000);
  $(".tagline").typed({
                      strings: ["Assistant Professor"],
                      typeSpeed: 10,
                      backDelay: 0,
                      startDelay: 100,
                      loop: false,
                      loopCount: 1,
                      cursorChar: "",
                      callback: endtype
                    });
  $(".tagline2").typed({
                      strings: ["Warwick Manufacturing Group"],
                      typeSpeed: 10,
                      backDelay: 0,
                      startDelay: 300,
                      loop: false,
                      loopCount: 1,
                      cursorChar: "",
                      callback: endtype
                    });
  $(".tagline3").typed({
                      strings: ["University of Warwick"],
                      typeSpeed: 10,
                      backDelay: 0,
                      startDelay: 600,
                      loop: false,
                      loopCount: 1,
                      cursorChar: "",
                      callback: endtype
                    });
};

var name2 = function() {
  $(".typed-cursor").hide();
  $(".author-name2").typed({
                      strings: ["&nbsp;Zhang"],
                      typeSpeed: 0,
                      backDelay: 0,
                      startDelay: 250,
                      loop: false,
                      loopCount: 1,
                      cursorChar: "|",
                      callback: tagline
                    });
};

var name1 = function() {
  $(".author-name").typed({
                    strings: ["Andi"],
                    typeSpeed: 0,
                    backDelay: 0,
                    startDelay: 400,
                    loop: false,
                    loopCount: 1,
                    cursorChar: "|",
                    callback: name2
                  });
};

$(window).load(function() {
  $(".logo-container").delay(100).fadeIn(1000, name1);
});

